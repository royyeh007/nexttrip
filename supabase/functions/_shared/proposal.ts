// 「行程提案」的格式：上傳解析和聊天機器人都產生這個，存進 uploads.parsed，使用者按「確認更新」才生效。
import { z } from "npm:zod@4";

// 日期用完整的 YYYY-MM-DD（行程可以在任何年份、跨年）
/** 格式對、而且是月曆上真的有的一天（2026-13-45、2027-02-30 這種會變成 NaN/NaN 的日子不收） */
const isRealDate = (s: string) => { const d = new Date(s + "T00:00:00Z"); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
export const DateIdZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, "不是真的日期").describe("日期，格式 YYYY-MM-DD，例如 2026-12-25");
export const KINDS = ["food", "sight", "hotel", "shop", "move"] as const;
export const MODES = ["taxi", "walk", "train", "bus", "charter", "shuttle", "flight"] as const;
export const STATUSES = ["ok", "todo", "tbd"] as const;

// 結構化輸出要求每個欄位都出現，所以「沒有」用 null 或空陣列表示，之後 normalize() 再拿掉。
const StopZ = z.object({
  type: z.literal("stop"),
  t: z.string().describe("預計到達時間，24 小時制 H:MM，例如 13:00、8:45"),
  n: z.string().describe("地點或活動名稱，餐廳前面加「午餐：」「晚餐：」"),
  q: z.string().nullable().describe("在 Google 地圖搜尋這個地方用的字，當地語言的店名最準（照格式說明）；修改既有行程時沿用的地點填 null，系統會保留原本的"),
  k: z.enum(KINDS).describe("food 餐廳／sight 景點／hotel 住宿／shop 購物／move 交通（機場、車站這種）"),
  st: z.enum(STATUSES).nullable().describe("訂位狀態 ok 已訂／todo 要訂／tbd 待定；不用訂就 null"),
  who: z.string().nullable().describe("只有部分人參加時寫誰，例如「4 位女生」，否則 null"),
  s: z.string().nullable().describe("一句話的補充說明，沒有就 null"),
  info: z.array(z.string()).describe("營業時間、價格這類資訊，一條一項"),
  book: z.array(z.string()).describe("訂位資訊：訂了幾人幾點、訂位編號、訂位名，一條一項"),
  rec: z.array(z.string()).describe("推薦餐點或必看的東西"),
  tips: z.array(z.string()).describe("提醒"),
  addr: z.string().nullable(),
  tel: z.string().nullable(),
});
const LegZ = z.object({
  type: z.literal("leg"),
  leg: z.enum(MODES).describe("taxi 計程車／walk 走路／train 電車／bus 巴士／charter 包車／shuttle 接駁車／flight 飛機"),
  txt: z.string().describe("交通說明：幾分鐘、多少錢、哪一線"),
  st: z.enum(STATUSES).nullable().describe("這段交通要不要訂（包車、新幹線）"),
});
export const DayZ = z.object({
  date_id: DateIdZ,
  scope: z.enum(["family", "shared"]).describe("family = 這一家自己的那一天；shared = 大家一起的日子"),
  city: z.string().describe("那天主要在哪個城市，例如 東京、長野、輕井澤"),
  title: z.string().describe("那天的標題，例如「抵達東京・築地・濱離宮」"),
  hotel: z.string().describe("那晚住的飯店；回家或不知道就空字串"),
  items: z.array(z.union([StopZ, LegZ])).describe("照時間順序，地點之間放交通"),
});
export const ProposalZ = z.object({
  family_id: z.string().describe("這份行程是哪一家的（家庭 id，見格式說明的家庭清單）"),
  flights: z.array(z.string()).describe("去回航班，例如「去 BR192 12/26 松山 07:15 → 羽田 T3 11:00」；沒提到就空陣列"),
  days: z.array(DayZ).describe("完整的每一天。改一天就要給那一天完整的內容（不是只給改的部分）"),
  joins: z.array(z.object({
    date_id: DateIdZ,
    with: z.string().describe("跟哪一家一起（家庭 id）"),
    from: z.string().nullable().describe("從幾點開始一起（H:MM）；整天都一起就 null"),
  })).describe("某天是跟別家一起走的，列在這裡而不是重抄那家的行程"),
  summary: z.string().describe("一兩句話說明這份提案改了什麼，給確認的人看"),
  notes: z.array(z.string()).describe("看不懂、不確定、資料矛盾的地方，一條一項"),
  extend_to: z.object({
    start_date: DateIdZ.nullable().describe("要把行程的開始日期提早到哪天；不用就 null"),
    end_date: DateIdZ.nullable().describe("要把行程的結束日期延後到哪天；不用就 null"),
  }).describe("這份提案有日期超出行程範圍、而且使用者同意延長行程時才填；否則兩個都 null"),
});
export type Proposal = z.infer<typeof ProposalZ>;

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
/** "2026-12-26" → { d: "12/26", w: "六" } */
export function dateOf(iso: string) {
  const dt = new Date(iso + "T00:00:00Z");
  return { d: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`, w: WEEKDAY[dt.getUTCDay()] };
}

/** Convert the strict AI shape into the app's Day shape (no nulls, no empty arrays, d/w filled in). */
export function normalize(p: Proposal) {
  const clean = (o: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "type" || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      out[k] = v;
    }
    return out;
  };
  return {
    family_id: p.family_id,
    flights: p.flights,
    days: p.days.map((day) => ({
      id: day.date_id,
      ...dateOf(day.date_id),
      city: day.city,
      title: day.title,
      hotel: day.hotel,
      scope: day.scope,
      items: day.items.map((it) => clean(it as Record<string, unknown>)),
    })),
    joins: p.joins,
    summary: p.summary,
    notes: p.notes,
    extend_to: p.extend_to && (p.extend_to.start_date || p.extend_to.end_date) ? p.extend_to : null,
  };
}

export interface GuideCtx {
  trip: { name: string; start_date: string; end_date: string; place: string };
  families: { id: string; label: string }[];
  /** dates (YYYY-MM-DD) that currently have an everyone-together version */
  sharedDates: string[];
  /** 用上傳建立新行程：名稱、城市、日期都還沒定，要從內容讀出來。值是今天的日期（YYYY-MM-DD）。 */
  fresh?: string;
}

/** 用上傳建立新行程時，AI 從內容讀到的基本資料；讀不到的是 null，之後請使用者補。 */
export const TripGuessZ = z.object({
  name: z.string().nullable().describe("行程名稱；內容沒寫就照地點和時間取一個短的，例「2027 春天京都」"),
  place: z.string().nullable().describe("主要城市，寫成「國家・城市」，例「日本・京都」；看不出來就 null"),
  start_date: DateIdZ.nullable().describe("行程第一天；內容完全沒有日期就 null"),
  end_date: DateIdZ.nullable().describe("行程最後一天；內容完全沒有日期就 null"),
});
export const FreshProposalZ = ProposalZ.extend({ trip: TripGuessZ });

/** The format rules the AI follows, filled in with this trip's families and shared days. */
export function formatGuide(ctx: GuideCtx) {
  if (ctx.fresh) return freshGuide(ctx, ctx.fresh);
  const { trip, families, sharedDates } = ctx;
  const fams = families.map((f) => `${f.id}=${f.label}`).join("、") || "（還沒有家庭）";
  const shared = sharedDates.length ? sharedDates.map((d) => dateOf(d).d).join("、") : "目前沒有";
  return `行程格式說明：
- 這個行程是「${trip.name}」${trip.place ? `（${trip.place}）` : ""}，${trip.start_date} 到 ${trip.end_date}；各家的日期可以不一樣，前後幾天也可以。
- 一天 = date_id（YYYY-MM-DD）+ city + title + hotel + items。
- items 照時間順序：每個地點是 type=stop；兩個地點中間的交通是 type=leg。
- stop 的 k：餐廳 food、景點 sight、住宿 hotel、購物 shop、機場車站等交通節點 move。
- leg 的 leg：計程車 taxi、走路 walk、電車 train、巴士 bus、包車 charter、接駁車 shuttle、飛機 flight。
- 訂位狀態 st：已訂 ok、要訂 todo、待定 tbd、不用訂 null。
- 時間用 24 小時制 H:MM（8:30、13:00）。清單欄位（book、rec、tips、info）一條一項，表單裡用「；」分開的要拆開。
- q 是 Google 地圖的搜尋字：用當地語言的官方店名＋區域（例「ミキモト 銀座本店」）；新開的店、連鎖店或名字很普通的店，一定在 q 後面加上地址（例「東京銀座 茅乃舎 東京都中央区銀座3-4-8」），不然地圖會找錯。有查到地址就同時填 addr。改既有的一天時，沿用（沒改名）的地點 q 填 null，系統會保留原本的搜尋字。
- 大家一起的日子（scope=shared）：${shared}；其他日子各家自己走（scope=family）。
- 如果某天是「跟某家一起」，放進 joins（有「從幾點開始」就填 from），不要重抄那家的行程。
- 日期超出行程範圍（${trip.start_date}–${trip.end_date}）的日子一樣可以放進 days；如果要順便把行程日期延長，填 extend_to（新的開始或結束日期）。
- 家庭 id：${fams}。`;
}

/** 全新的行程：沒有名稱、日期可以對照，也沒有別家；每一天都是大家一起的。 */
function freshGuide({ families }: GuideCtx, today: string) {
  const fams = families.map((f) => `${f.id}=${f.label}`).join("、");
  return `行程格式說明：
- 這是一個全新的行程：名稱、主要城市、日期都還沒定，要從內容讀出來填進 trip。今天是 ${today}。
- 內容裡的日期沒有年份：用今天之後最近的那一次。
- 內容完全沒有日期（只有「第 1 天」「Day 2」這種）：date_id 從 ${today} 開始一天一天往後排，trip 的 start_date 和 end_date 填 null，並在 notes 寫一條「內容沒有日期」。
- 一天 = date_id（YYYY-MM-DD）+ city + title + hotel + items。
- items 照時間順序：每個地點是 type=stop；兩個地點中間的交通是 type=leg。
- stop 的 k：餐廳 food、景點 sight、住宿 hotel、購物 shop、機場車站等交通節點 move。
- leg 的 leg：計程車 taxi、走路 walk、電車 train、巴士 bus、包車 charter、接駁車 shuttle、飛機 flight。
- 訂位狀態 st：已訂 ok、要訂（內容寫要先訂、建議預約）todo、待定 tbd、不用訂 null。
- 時間用 24 小時制 H:MM（8:30、13:00）。清單欄位（book、rec、tips、info）一條一項；營業時間、費用放 info，推薦放 rec，提醒放 tips。
- 內容寫「不確定」「無」「自行安排」的欄位當作沒有（null、空字串或空陣列），不要照抄。
- q 是 Google 地圖的搜尋字：用當地語言的官方店名＋區域（例「ミキモト 銀座本店」）；新開的店、連鎖店或名字很普通的店，一定在 q 後面加上地址。內容有地址就同時填 addr。
- n 是給人看的名稱：內容同時有當地語言和使用者語言的名稱時，用使用者看得懂的那個（例「淺草寺」）。
- 每一天的 scope 都填 shared。joins 給空陣列。extend_to 兩個都填 null。
- 家庭 id：${fams}。`;
}
