// 建立新行程的兩個幫手：
// 1. 照使用者選的條件，產生一段可以貼給任何 AI（ChatGPT、Gemini、Claude…）的提示，AI 的回答照固定格式，整段貼回來就能讀成行程。
// 2. 讀出來的行程提案整份換日期（使用者補開始日期時用）。
import { addDays, dateOf } from "./data";
import type { Proposal } from "./data";

export const WANTS = ["sight", "food", "hotel", "shop", "move"] as const;
export type Want = (typeof WANTS)[number];
export const PACES = ["easy", "normal", "full"] as const;
export type Pace = (typeof PACES)[number];
export const MOVES = ["any", "transit", "car", "charter"] as const;
export type Move = (typeof MOVES)[number];
export const MAX_PROMPT_DAYS = 21;

export interface PromptOpts {
  place: string;
  /** YYYY-MM-DD；空的 = 日期還沒決定 */
  start: string;
  days: number;
  people: string;
  /** 要 AI 推薦哪幾種；空的或全選 = 全部 */
  want: Want[];
  pace: Pace;
  move: Move;
  booked: string;
  notes: string;
}

const ZH = {
  want: { sight: "景點", food: "餐廳（午餐和晚餐）", hotel: "住宿", shop: "購物", move: "地點之間的交通" } as Record<Want, string>,
  pace: { easy: "輕鬆（一天 3 到 4 個地點）", normal: "普通（一天 4 到 6 個地點）", full: "緊湊（一天 6 個以上）" } as Record<Pace, string>,
  move: { any: "", transit: "大眾運輸為主", car: "自己開車", charter: "包車或計程車為主" } as Record<Move, string>,
};
const EN = {
  want: { sight: "sights", food: "restaurants (lunch and dinner)", hotel: "places to stay", shop: "shopping", move: "how to get from one place to the next" } as Record<Want, string>,
  pace: { easy: "relaxed (3 to 4 places a day)", normal: "normal (4 to 6 places a day)", full: "packed (6 or more a day)" } as Record<Pace, string>,
  move: { any: "", transit: "mostly public transport", car: "driving ourselves", charter: "mostly private driver or taxi" } as Record<Move, string>,
};

const clampDays = (n: number) => Math.min(MAX_PROMPT_DAYS, Math.max(1, Math.round(Number(n)) || 1));
const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** 給外面的 AI 的提示。純文字，不經過翻譯表（整段照介面語言寫好）。 */
export function buildTripPrompt(o: PromptOpts, lang: "zh" | "en" = "zh"): string {
  const days = clampDays(o.days);
  const want = WANTS.filter((w) => o.want.length === 0 || o.want.includes(w));
  const all = want.length === WANTS.length;
  const has = (w: Want) => want.includes(w);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(o.start) ? o.start : "";
  const end = start ? addDays(start, days - 1) : "";
  const place = one(o.place), people = one(o.people), booked = one(o.booked), notes = one(o.notes);

  if (lang === "en") {
    const L = EN;
    const cond = [
      `- Destination: ${place}`,
      start ? `- Dates: ${start} to ${end}, ${days} day${days === 1 ? "" : "s"}` : `- Length: ${days} day${days === 1 ? "" : "s"} (dates not decided yet)`,
      people && `- Who is going: ${people}`,
      `- Pace: ${L.pace[o.pace]}`,
      L.move[o.move] && `- Getting around: ${L.move[o.move]}`,
      booked && `- Already booked (keep these as they are): ${booked}`,
      notes && `- Other wishes: ${notes}`,
    ].filter(Boolean).join("\n");
    const kinds = ["sight", has("food") && "restaurant", has("hotel") && "hotel", has("shop") && "shop", "transport"].filter(Boolean).join(" / ");
    const day1 = start ? `== Day 1 ${start} ==` : "== Day 1 ==";
    return `Please plan a trip for me.

[Conditions]
${cond}

[Recommend]
${want.map((w) => L.want[w]).join(", ")}
${all ? "" : `Recommend only these kinds.${has("food") ? "" : " Do not pick restaurants: leave meal times free."}${has("hotel") ? "" : " Do not pick places to stay: write \"own choice\" on the Stay line."}${has("move") ? "" : " Leave out the lines that start with ->."}\n`}
[Rules]
1. Only real places that are open now. Write each name the way it is officially written in the local language, then the English name in brackets.
2. Every place needs an address. If you are not sure about a field write "not sure". Never make up prices, opening hours or booking numbers.
3. Keep each day's places close together, in time order, with time left for meals and for getting around.
4. Keep every field short: one line each.
5. Times in 24-hour form (9:00, 13:30).${start ? "" : "\n6. Dates are not decided: number the days Day 1, Day 2 and do not write dates."}

[Answer format]
Put the whole answer inside one code block (\`\`\`), exactly in the format below. Leave no field out and write nothing outside the block. I will copy all of it into a trip app.

Trip name: (a short one you choose, for example: Kyoto spring 2027)
Main city: (city, country)
${start ? `Dates: ${start} to ${end}` : `Days: ${days}`}

${day1}
City:
Title: (what this day is about, under 8 words)
Stay: ${has("hotel") ? "(hotel name; address)" : "own choice"}
9:00 | sight | Name in local language (English name)
  Address:
  About:
  Hours:
  Cost:
  Do not miss:
  Tips:
  Book ahead: yes / no
${has("move") ? "-> train | which line, how many minutes, about how much\n" : ""}${has("food") ? "12:00 | restaurant | Lunch: Name in local language (English name)\n  (same fields as above)\n" : ""}
(Write every day like this, up to Day ${days}. Kinds: ${kinds}.${has("move") ? " Ways to get around: walk / train / bus / taxi / private driver / shuttle / flight." : ""})`;
  }

  const L = ZH;
  const cond = [
    `- 目的地：${place}`,
    start ? `- 日期：${start} 到 ${end}，共 ${days} 天` : `- 天數：${days} 天（日期還沒決定）`,
    people && `- 同行的人：${people}`,
    `- 步調：${L.pace[o.pace]}`,
    L.move[o.move] && `- 交通：${L.move[o.move]}`,
    booked && `- 已經訂好的（照樣排進去，不要改）：${booked}`,
    notes && `- 其他要求：${notes}`,
  ].filter(Boolean).join("\n");
  const kinds = ["景點", has("food") && "餐廳", has("hotel") && "住宿", has("shop") && "購物", "交通"].filter(Boolean).join("／");
  const day1 = start ? `== 第 1 天 ${start} ==` : "== 第 1 天 ==";
  return `請幫我排一份旅遊行程。

【條件】
${cond}

【請推薦】
${want.map((w) => L.want[w]).join("、")}
${all ? "" : `只推薦上面這幾種。${has("food") ? "" : "餐廳不用推薦，吃飯時間留空就好。"}${has("hotel") ? "" : "住宿不用推薦，「住宿」那一行寫「自行安排」。"}${has("move") ? "" : "不用寫「→」開頭的交通那幾行。"}\n`}
【規則】
1. 只推薦真的存在、現在還在營業的地方。名稱先寫當地語言的正式名稱，後面括號寫中文。
2. 每個地點都要有地址。不確定的欄位寫「不確定」，不要自己編；價格、營業時間、訂位編號不知道就不要寫數字。
3. 路線要順：同一天的地點排在附近，照時間順序，留吃飯和移動的時間。
4. 每個欄位寫短一點，一行講完。
5. 時間用 24 小時制（9:00、13:30）。${start ? "" : "\n6. 日期還沒決定：用「第 1 天」「第 2 天」編號，不要寫日期。"}

【回答格式】
整個回答放在一個程式碼區塊（\`\`\`）裡，完全照下面的格式，一個欄位都不要少，區塊外面不要寫任何字。我會整段複製貼到行程 App。

行程名稱：（自己取一個短的，例：2027 春天京都）
主要城市：（國家・城市）
${start ? `日期：${start} 到 ${end}` : `天數：${days}`}

${day1}
城市：
標題：（這天的重點，20 字內）
住宿：${has("hotel") ? "（飯店名稱；地址）" : "自行安排"}
9:00｜景點｜當地語言名稱（中文名稱）
  地址：
  說明：
  營業時間：
  費用：
  推薦：
  提醒：
  要不要先訂：要／不用
${has("move") ? "→ 電車｜搭哪一線、幾分鐘、大約多少錢\n" : ""}${has("food") ? "12:00｜餐廳｜午餐：當地語言名稱（中文名稱）\n  （欄位同上）\n" : ""}
（每一天都照這樣寫，到第 ${days} 天。種類：${kinds}。${has("move") ? "交通方式：走路／電車／巴士／計程車／包車／接駁車／飛機。" : ""}）`;
}

/** 提案裡最早和最晚的日期；沒有任何一天時是 null。 */
export function proposalRange(p: Pick<Proposal, "days">): { first: string; last: string } | null {
  const ids = p.days.map((d) => d.id).sort();
  return ids.length ? { first: ids[0], last: ids[ids.length - 1] } : null;
}

/** 整份提案往後（負的往前）移幾天：每一天的日期、幾月幾號、星期一起改，內容不動。 */
export function shiftProposal<P extends Pick<Proposal, "days">>(p: P, delta: number): P {
  if (!delta) return p;
  return { ...p, days: p.days.map((d) => { const id = addDays(d.id, delta); return { ...d, id, ...dateOf(id) }; }) };
}
