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
    // 不把 Google 的錯誤內容原樣丟回前端（可能帶專案資訊），只回狀態碼和類別；全文留在函式的紀錄裡
    const raw = (await r.text().catch(() => "")).slice(0, 600);
    console.error("place-search google", r.status, raw);
    let why = ""; try { why = (JSON.parse(raw) as { error?: { status?: string } }).error?.status ?? ""; } catch { /* 不是 JSON */ }
    throw new HttpError(502, `地點搜尋暫時不能用（${r.status} ${why}）`);
  }
  return await r.json() as Record<string, unknown>;
}

// ---- Google 地圖的分享連結 ----
// 只跟著 Google 自己的網域轉址，只讀轉址的位置（Location），不抓頁面內容；其他網址一律不碰（避免被拿來打別的主機）。
const MAP_HOST = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|(www\.|maps\.|consent\.)?google\.(com|co\.jp|com\.tw|co\.kr|co\.uk|com\.hk))$/;
const mapUrl = (raw: string): URL | null => {
  try { const u = new URL(raw); return u.protocol === "https:" && !u.port && !u.username && MAP_HOST.test(u.hostname) ? u : null; } catch { return null; }
};
/** What a Google Maps URL says about the place: its name (may include the address) and, when present, where it is. */
function readMapUrl(u: URL): { text: string; lat: number | null; lon: number | null } {
  let text = "";
  const m = u.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/);
  if (m) { try { text = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch { text = m[1].replace(/\+/g, " "); } }
  if (!text && (u.hostname.startsWith("maps.") || u.pathname.startsWith("/maps"))) text = u.searchParams.get("q") ?? u.searchParams.get("query") ?? "";
  if (/^https?:/i.test(text)) text = "";
  const all = u.pathname + u.search;
  // !3d…!4d… 是那個地點本身；@… 只是地圖的中心，沒有前者才用
  const pin = all.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ?? all.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const lat = pin ? num(Number(pin[1]), 90) : null, lon = pin ? num(Number(pin[2]), 180) : null;
  // 搜尋字本身就是座標（長按地圖放的圖釘）：沒有店名可找
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(text.trim())) text = "";
  return { text: text.replace(/\s+/g, " ").trim().slice(0, 200), lat, lon };
}
async function resolveMapLink(raw: string): Promise<{ text: string; lat: number | null; lon: number | null }> {
  let u = mapUrl(raw);
  if (!u) throw new HttpError(400, "這不是 Google 地圖的連結");
  for (let hop = 0; hop < 5; hop++) {
    if (u.hostname.startsWith("consent.")) { const c = mapUrl(u.searchParams.get("continue") ?? ""); if (!c) break; u = c; continue; }
    const got = readMapUrl(u);
    if (got.text) return got;
    let r: Response;
    try { r = await fetch(u, { redirect: "manual", headers: { "accept-language": "zh-TW,zh;q=0.9,en;q=0.8" }, signal: AbortSignal.timeout(6000) }); }
    catch { throw new HttpError(504, "連結沒有回應，稍後再試"); }
    await r.body?.cancel().catch(() => {});
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    const next = loc ? mapUrl(new URL(loc, u).toString()) : null;
    if (!next) break;
    u = next;
  }
  throw new HttpError(422, "這個連結裡找不到地點，改用打字找找看");
}

Deno.serve(handle(async (req) => {
  const body = await readJson<{ trip_id?: string; action?: unknown; input?: unknown; session?: unknown; lang?: unknown; lat?: unknown; lon?: unknown; place_id?: unknown; kind?: unknown; url?: unknown }>(req, 4000);
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

  if (body.action === "link") {
    if (!tripId) throw new HttpError(400, "缺 trip_id");
    const raw = typeof body.url === "string" ? body.url.trim().slice(0, 1500) : "";
    if (!mapUrl(raw)) throw new HttpError(400, "這不是 Google 地圖的連結"); // 不是地圖連結的不算次數
    const quota = await reserve(admin, "place-details", { tripId, uid, tz });
    let got: Awaited<ReturnType<typeof resolveMapLink>>;
    try { got = await resolveMapLink(raw); } catch (e) { await settle(admin, quota, { link: true, found: false }); throw e; }
    const nearLat = num(body.lat, 90), nearLon = num(body.lon, 180); // 連結裡沒有座標時，偏向那一天的城市
    const j = await google("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.location" },
      body: JSON.stringify({ textQuery: got.text, languageCode, pageSize: 1, ...(got.lat != null && got.lon != null ? { locationBias: { circle: { center: { latitude: got.lat, longitude: got.lon }, radius: 500 } } }
        : nearLat != null && nearLon != null ? { locationBias: { circle: { center: { latitude: nearLat, longitude: nearLon }, radius: 50000 } } } : {}) }),
    });
    const p = (Array.isArray(j.places) ? j.places[0] : null) as { id?: unknown; displayName?: { text?: unknown }; formattedAddress?: unknown; internationalPhoneNumber?: unknown; location?: { latitude?: unknown; longitude?: unknown } } | null;
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
    await settle(admin, quota, { link: true, found: !!p });
    // Google 找不到對應的店：至少把連結裡的名字帶回去
    if (!p) return json({ name: got.text.split(",")[0].slice(0, 120), address: "", tel: "" });
    let address = str(p.formattedAddress, 300);
    // 中文介面下完整地址常是羅馬拼音（4-chōme-2-8 Shibakōen…）；建議清單那一行才是中文，所以用店名再查一次清單，拿同一個地點的那一行
    const name = str(p.displayName?.text, 120), plat = num(p.location?.latitude, 90), plon = num(p.location?.longitude, 180);
    if (languageCode === "zh-TW" && name && plat != null && plon != null && typeof p.id === "string") {
      try {
        const a = await google("https://places.googleapis.com/v1/places:autocomplete", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat" },
          body: JSON.stringify({ input: name.slice(0, 80), languageCode, locationBias: { circle: { center: { latitude: plat, longitude: plon }, radius: 300 } } }),
        });
        const hit = (Array.isArray(a.suggestions) ? a.suggestions : []).map((x) => (x as { placePrediction?: { placeId?: string; structuredFormat?: { secondaryText?: { text?: string } } } }).placePrediction).find((x) => x?.placeId === p.id);
        const sub = hit?.structuredFormat?.secondaryText?.text;
        if (sub) address = sub.slice(0, 300);
      } catch { /* 查不到中文那一行就用原本的地址 */ }
    }
    return json({ name, address, tel: str(p.internationalPhoneNumber, 40) });
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
