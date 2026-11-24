// AI 用量的共用程式：牌價、把每次 API 呼叫的 usage 加總成美金、每日上限（ai_calls 表）。
// 每個會呼叫 Claude 的函式都先 reserve() 記一筆（超過上限就擋），跑完再 settle() 補上實際用量。
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

/** 美金／百萬 token（2026-11 官方定價）。快取寫入：5 分鐘是輸入價的 1.25 倍、1 小時是 2 倍。網頁搜尋每次 0.01。 */
export const PRICES: Record<string, { input: number; cache_5m: number; cache_1h: number; read: number; output: number }> = {
  "claude-opus-5-5": { input: 4, cache_5m: 5, cache_1h: 8, read: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cache_5m: 2.5, cache_1h: 4, read: 0.1, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cache_5m: 0.125, cache_1h: 0.2, read: 0.01, output: 0.5 },
};
export const SEARCH_USD = 0.01;

const n = (v: unknown) => (typeof v === "number" ? v : 0);
export interface Tokens { calls: number; input: number; cache_write_1h: number; cache_write_5m: number; cache_read: number; output: number; searches: number; usd: number }

/** 把一則訊息裡每次 API 呼叫的 usage 加起來，照 `model` 的牌價估美金。 */
export function sumUsage(model: string, calls: unknown[]): Tokens {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  const t = { calls: calls.length, input: 0, cache_write_1h: 0, cache_write_5m: 0, cache_read: 0, output: 0, searches: 0 };
  for (const raw of calls) {
    const u = (raw ?? {}) as Record<string, unknown>;
    t.input += n(u.input_tokens); t.cache_read += n(u.cache_read_input_tokens); t.output += n(u.output_tokens);
    const cc = u.cache_creation as Record<string, unknown> | undefined;
    if (cc) { t.cache_write_1h += n(cc.ephemeral_1h_input_tokens); t.cache_write_5m += n(cc.ephemeral_5m_input_tokens); }
    else t.cache_write_5m += n(u.cache_creation_input_tokens);
    t.searches += n((u.server_tool_use as Record<string, unknown> | undefined)?.web_search_requests);
  }
  const usd = (t.input * p.input + t.cache_write_1h * p.cache_1h + t.cache_write_5m * p.cache_5m + t.cache_read * p.read + t.output * p.output) / 1e6 + t.searches * SEARCH_USD;
  return { ...t, usd: Math.round(usd * 10000) / 10000 };
}

/** The instant this calendar day started in the given time zone (daily caps reset at the trip's local midnight). */
export function startOfToday(tz: string): string {
  const ymd = new Date().toLocaleDateString("sv-SE", { timeZone: tz }); // YYYY-MM-DD
  const guess = new Date(ymd + "T00:00:00Z");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime())).toISOString();
}

const envInt = (name: string, fallback: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : fallback; };

/** 每個功能的每日上限：每個人（跨所有行程）和每個行程各一個。可以用環境變數調，例如 CHAT_DAILY_USER=120。 */
export const LIMITS = {
  chat: () => ({ user: envInt("CHAT_DAILY_USER", 80), trip: envInt("CHAT_DAILY_TRIP", 300) }),
  "parse-upload": () => ({ user: envInt("UPLOAD_DAILY_USER", 15), trip: envInt("UPLOAD_DAILY_TRIP", 40) }),
  "optimize-day": () => ({ user: envInt("OPTIMIZE_DAILY_USER", 30), trip: envInt("OPTIMIZE_DAILY_TRIP", 60) }),
  "format-info": () => ({ user: envInt("INFO_FORMAT_DAILY_USER", 10), trip: envInt("INFO_FORMAT_DAILY_LIMIT", 10) }),
  "card-lookup": () => ({ user: envInt("CARD_LOOKUP_DAILY_USER", 10), trip: envInt("CARD_LOOKUP_DAILY_LIMIT", 10) }),
  // 背景地標配對：一個城市只會問一次（結果所有人共用），一趟行程頂多十幾個城市
  "match-place": () => ({ user: envInt("MATCH_PLACE_DAILY_USER", 30), trip: envInt("MATCH_PLACE_DAILY_TRIP", 40) }),
  // 卡片庫英文：存一張卡翻一次，只翻缺的句子
  "translate-card": () => ({ user: envInt("TRANSLATE_CARD_DAILY_USER", 40), trip: envInt("TRANSLATE_CARD_DAILY_TRIP", 60) }),
} as const;
export type Kind = keyof typeof LIMITS;
const KIND_NAME: Record<Kind, string> = { chat: "Trip醬", "parse-upload": "上傳整理", "optimize-day": "幫我排順序", "format-info": "幫我整理", "card-lookup": "幫我查這張卡", "match-place": "背景配對", "translate-card": "卡片庫英文" };

export interface Reservation { id: number | null; remaining: number }

/**
 * 先記一筆再呼叫模型：同時送出的請求也算得到彼此（原本是「先數、模型跑完才記」，平行送就全部通過，失敗的也不算）。
 * 超過上限會把剛記的那筆刪掉並丟 429。`remaining` 是這個行程今天還剩幾次。
 */
export async function reserve(admin: SupabaseClient, kind: Kind, o: { tripId: string; uid: string; tz: string }): Promise<Reservation> {
  const limit = LIMITS[kind]();
  const since = startOfToday(o.tz || "Asia/Tokyo");
  const { data: row, error } = await admin.from("ai_calls").insert({ trip_id: o.tripId, user_id: o.uid, kind, usage: { pending: true } }).select("id").single();
  if (error || !row) {
    // 記不進去（表還沒建、資料庫忙）不擋功能，但留下紀錄
    console.error(`ai_calls insert failed (${kind}):`, error?.message);
    return { id: null, remaining: limit.trip };
  }
  const [byUser, byTrip] = await Promise.all([
    admin.from("ai_calls").select("id", { count: "exact", head: true }).eq("user_id", o.uid).eq("kind", kind).gte("created_at", since),
    admin.from("ai_calls").select("id", { count: "exact", head: true }).eq("trip_id", o.tripId).eq("kind", kind).gte("created_at", since),
  ]);
  const usedUser = byUser.count ?? 0, usedTrip = byTrip.count ?? 0;
  if (usedUser > limit.user || usedTrip > limit.trip) {
    await admin.from("ai_calls").delete().eq("id", row.id);
    const who = usedUser > limit.user ? `你今天已經用了 ${limit.user} 次` : `這個行程今天已經用了 ${limit.trip} 次`;
    throw new HttpError(429, `「${KIND_NAME[kind]}」${who}，明天再試`);
  }
  return { id: row.id as number, remaining: Math.max(0, Math.min(limit.trip - usedTrip, limit.user - usedUser)) };
}

/** 補上實際用量（成功或失敗都記，花掉的錢才對得起來）。 */
export async function settle(admin: SupabaseClient, r: Reservation, usage: Record<string, unknown>) {
  if (r.id == null) return;
  const { error } = await admin.from("ai_calls").update({ usage }).eq("id", r.id);
  if (error) console.error("ai_calls update failed:", error.message);
}
