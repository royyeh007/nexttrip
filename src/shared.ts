// 共同的地點：各家那一天的行程裡各有一份，帶同一個 sid；內容由資料庫函式一次改掉所有份
// （supabase/migrations/20261126000000_shared_stops.sql）。
import { supabase } from "./supabase";
import { daysFor, isLeg } from "./data";
import type { Day, FamilyId, Stop } from "./data";

const has = (d: Day | undefined, sid: string) => !!d && d.items.some((it) => !isLeg(it) && it.sid === sid);

/** Which families have this stop in the day they see (their own version, a joint one, or everyone's). One family or none = not shared. */
export function sharedFamilies(days: Day[], families: { id: FamilyId }[], dateId: string, sid: string | undefined): FamilyId[] {
  if (!sid) return [];
  return families.filter((f) => has(daysFor(days, f.id).find((d) => d.id === dateId), sid)).map((f) => f.id);
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase 還沒設定");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.code === "PGRST202" || error.code === "42883" ? "這個功能要先升級資料庫（make db-push）" : error.message);
  return data as T;
}

export const sharedApi = {
  /** Put this stop into those families' day too. Returns its sid. */
  share: (trip: string, rowId: string, stop: { t: string; n: string }, fams: FamilyId[]) => call<string>("shared_stop_share", { p_trip: trip, p_row: rowId, p_t: stop.t, p_n: stop.n, p_fams: fams }),
  /** Take it out of those families' day; `null` = out of every family's (cancel it altogether). */
  unshare: (trip: string, dateId: string, sid: string, fams: FamilyId[] | null) => call<number>("shared_stop_unshare", { p_trip: trip, p_date: dateId, p_sid: sid, p_fams: fams }),
  patch: (trip: string, dateId: string, sid: string, patch: Record<string, unknown>, skipRow?: string) =>
    call<number>("shared_stop_patch", { p_trip: trip, p_date: dateId, p_sid: sid, p_patch: patch, p_skip_row: skipRow ?? null }),
};

const CONTENT = ["t", "n", "q", "k", "st", "who", "s", "info", "book", "rec", "tips", "addr", "tel", "ll", "ref"] as const;
/** Everything about a stop that every family's copy must agree on (null = the field is gone). Notes and who-takes-part are sent on their own. */
export function contentPatch(stop: Stop): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CONTENT) out[k] = stop[k] ?? null;
  return out;
}

/**
 * After a change to our own copy went through: make the other families' copies say the same.
 * Returns a message when that failed (our copy is already saved; the others still show the old content).
 */
export async function syncShared(trip: string, day: Day, sid: string | undefined, patch: Record<string, unknown>): Promise<string | null> {
  if (!sid) return null;
  try { await sharedApi.patch(trip, day.id, sid, patch, day.rowId); return null; }
  catch (e) { return `我們家這一份已經存好，但同步到其他家的時候失敗了：${e instanceof Error ? e.message : String(e)}`; }
}
