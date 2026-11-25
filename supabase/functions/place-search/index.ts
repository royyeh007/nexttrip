// 新增／編輯一站時的地點搜尋：打幾個字就出現可能的地點（Google Places API (New)），選了帶回名稱、地址、電話（座標不帶：Google 的條款只准暫存 30 天，路線規劃自己用地址去查）。
// 金鑰只放在 Supabase 的密鑰（GOOGLE_PLACES_KEY），瀏覽器拿不到；這裡也順便擋次數（ai_calls 表，每人、每個行程每天）。
// 計費（Google）：同一個 session 的建議查詢在最後有抓詳細資料（含電話那一級）時不另外收費，只收那一次詳細資料；
// 沒選就離開的 session 則每次建議查詢各算一次。所以前端一定要帶 session，選了就用同一個 session 抓詳細資料。
import { handle, json, HttpError, readJson } from "../_shared/http.ts";
import { clients, requireMember } from "../_shared/supa.ts";
import { LIMITS, reserve, settle, startOfToday } from "../_shared/usage.ts";

const KEY = () => Deno.env.get("GOOGLE_PLACES_KEY") ?? "";
const TOKEN_OK = /^[A-Za-z0-9_-]{8,64}$/;
const PLACE_OK = /^[A-Za-z0-9_-]{10,300}$/;
const num = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max ? v : null);

async function google(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let r: Response;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) }); }
  catch { throw new HttpError(504, "地點搜尋沒有回應，稍後再試"); }
  if (!r.ok) {
    // 不把 Google 的錯誤內容原樣丟回前端（可能帶專案資訊）；留在函式的紀錄裡
    console.error("place-search google", r.status, (await r.text().catch(() => "")).slice(0, 400));
    throw new HttpError(502, "地點搜尋暫時不能用");
  }
  return await r.json() as Record<string, unknown>;
}

Deno.serve(handle(async (req) => {
  const body = await readJson<{ trip_id?: string; action?: unknown; input?: unknown; session?: unknown; lang?: unknown; lat?: unknown; lon?: unknown; place_id?: unknown; kind?: unknown }>(req, 4000);
  // 找「城市」可以不帶行程（建立新行程時選主要城市）：那時只要有登入；其他都要是那個行程裡能編輯的人
  const cityOnly = body.kind === "city" && body.action === "suggest" && !body.trip_id;
  let admin, uid: string, tripId: string | null = null, tz = "Asia/Taipei";
  if (cityOnly) {
    const c = clients(req);
    const { data, error } = await c.user.auth.getUser();
    if (error || !data?.user) throw new HttpError(401, "請先登入");
    admin = c.admin; uid = data.user.id;
  } else {
    const m = await requireMember(req, body, { editor: true });
    admin = m.admin; uid = m.uid; tripId = m.trip.id; tz = m.trip.tz;
  }
  const key = KEY();
  if (!key) throw new HttpError(503, "地點搜尋還沒設定");
  const session = typeof body.session === "string" && TOKEN_OK.test(body.session) ? body.session : null;
  if (!session) throw new HttpError(400, "少了 session");
  const languageCode = body.lang === "en" ? "en" : "zh-TW";

  if (body.action === "suggest") {
    const input = typeof body.input === "string" ? body.input.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (input.length < 2) return json({ suggestions: [] });
    let quota = { id: null as number | null, remaining: 0 };
    if (tripId) quota = await reserve(admin, "place-search", { tripId, uid, tz });
    else {
      // 沒有行程：只數這個人今天查了幾次
      const limit = LIMITS["place-search"]().user;
      const { data: row } = await admin.from("ai_calls").insert({ trip_id: null, user_id: uid, kind: "place-search", usage: { pending: true } }).select("id").single();
      const { count } = await admin.from("ai_calls").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("kind", "place-search").gte("created_at", startOfToday(tz));
      if ((count ?? 0) > limit) { if (row) await admin.from("ai_calls").delete().eq("id", row.id); throw new HttpError(429, "「地點搜尋」今天查太多次了，明天再試"); }
      quota = { id: (row?.id as number | undefined) ?? null, remaining: 0 };
    }
    const lat = num(body.lat, 90), lon = num(body.lon, 180);
    const j = await google("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat" },
      body: JSON.stringify({ input, sessionToken: session, languageCode, ...(body.kind === "city" ? { includedPrimaryTypes: ["(cities)"] } : {}), ...(lat != null && lon != null ? { locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 50000 } } } : {}) }),
    });
    const suggestions = (Array.isArray(j.suggestions) ? j.suggestions : []).slice(0, 6).flatMap((s) => {
      const p = (s as { placePrediction?: { placeId?: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }).placePrediction;
      const main = p?.structuredFormat?.mainText?.text;
      return p?.placeId && main ? [{ id: p.placeId, main: main.slice(0, 120), sub: (p.structuredFormat?.secondaryText?.text ?? "").slice(0, 200) }] : [];
    });
    await settle(admin, quota, { input: input.length, n: suggestions.length, ...(body.kind === "city" ? { city: true } : {}) });
    return json({ suggestions });
  }

  if (body.action === "details") {
    const id = typeof body.place_id === "string" && PLACE_OK.test(body.place_id) ? body.place_id : null;
    if (!id) throw new HttpError(400, "少了地點");
    if (!tripId) throw new HttpError(400, "缺 trip_id");
    const quota = await reserve(admin, "place-details", { tripId, uid, tz });
    const j = await google(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?sessionToken=${session}&languageCode=${languageCode}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,formattedAddress,internationalPhoneNumber" },
    });
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
    await settle(admin, quota, { place: id });
    return json({ name: str((j.displayName as { text?: unknown } | undefined)?.text, 120), address: str(j.formattedAddress, 300), tel: str(j.internationalPhoneNumber, 40) });
  }
  throw new HttpError(400, "不知道要做什麼");
}));
