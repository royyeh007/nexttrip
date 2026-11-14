// 範例：seed/trip.ts 長這樣（真正的 trip.ts 不進 git）。這裡的人名、航班、飯店都是虛構的。
import type { Day, Family } from "../src/data";

// 這份資料屬於哪個行程。id 固定一個 UUID 就能重複 `make seed`；沒寫的話會用 .env.local 的 TRIP_ID 找既有的行程。
export const TRIP = { id: "00000000-0000-4000-8000-000000000001", name: "京都賞楓", start_date: "2030-11-20", end_date: "2030-11-24", place: "日本・京都、大阪", tz: "Asia/Tokyo" };

export const FAMILIES: Family[] = [
  { id: "alpha", name: "Alpha", label: "A 家", flights: ["去 XX123 11/20 桃園 08:10 → 關西 T1 11:45"] },
  { id: "beta", name: "Beta", label: "B 家", flights: [] },
];
export const SHARED_NOTE = "11/21–11/23 兩家一起";

// 日期 id 用完整日期；舊的 "d1120" 寫法也還能用（seed 會換成完整日期）。fam 不寫＝大家一起的日子。
export const DAYS: Day[] = [
  { id: "2030-11-20", fam: ["alpha"], d: "11/20", w: "三", city: "大阪", title: "抵達大阪", hotel: "範例飯店 梅田", items: [
    { t: "11:45", n: "抵達關西機場 T1", q: "関西国際空港 第1ターミナル", k: "move" },
    { leg: "train", txt: "機場快線 → 梅田，約 50 分鐘" },
    { t: "13:30", n: "飯店寄放行李", q: "大阪駅", k: "hotel" },
  ]},
  { id: "2030-11-21", d: "11/21", w: "四", city: "京都", title: "移動到京都", hotel: "範例旅館 京都", items: [] },
];
export const TODO: [string, string, string, boolean?][] = [["vjw", "11/10 前", "Visit Japan Web 全家填好"]];
export const CONTACTS: [string, string][] = [["範例旅館 訂房專線", "+81-00-0000-0000"]];
