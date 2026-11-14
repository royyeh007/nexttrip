// 航班文字的解析：網頁（src/）和 Edge Function 共用這一份。
// 兩邊各寫一份的時候，只要有一邊改了規則，網頁去要的快取 key 就會跟排程存的對不起來。
// 這個檔不能 import 任何 Deno／npm 的東西（Vite 也要能編）。

export interface DateRange { start: string; end: string } // YYYY-MM-DD

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayDiff = (a: string, b: string) => Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000;

/** "12/26" has no year in the flight text: pick the year that lands closest to (ideally inside) the trip's dates. */
export function resolveDate(month: number, day: number, range?: DateRange | null): string {
  if (!range) return `${new Date().getUTCFullYear()}-${pad2(month)}-${pad2(day)}`;
  const y0 = Number(range.start.slice(0, 4)), y1 = Number(range.end.slice(0, 4));
  let best = "", bestDist = Infinity;
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    const iso = `${y}-${pad2(month)}-${pad2(day)}`;
    const dist = iso < range.start ? dayDiff(iso, range.start) : iso > range.end ? dayDiff(iso, range.end) : 0;
    if (dist < bestDist) { best = iso; bestDist = dist; }
  }
  return best;
}

export interface FlightText {
  /** IATA two-letter airline code, upper case */
  airline: string;
  /** flight number as written (no leading-zero changes) */
  number: string;
  /** YYYY-MM-DD, local date at the departure airport */
  date: string;
  /** which of the airports we have special handling for the text mentions */
  airports: string[];
  /** the "BR192" part exactly as it appears in the text, and where */
  match: string;
  index: number;
}

/**
 * "去 BR192 12/26 松山 07:15 → 羽田 T3 11:00" → airline, number, date, airports.
 * The date comes from the "M/D" in the text; `fallbackDate` is used when the text has none (a flight leg inside a day).
 */
export function parseFlightText(text: string, range?: DateRange | null, fallbackDate?: string): FlightText | null {
  const m = text.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/);
  const d = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m || (!d && !fallbackDate)) return null;
  const date = d ? resolveDate(Number(d[1]), Number(d[2]), range) : fallbackDate!;
  const airports: string[] = [];
  if (/羽田|HND/i.test(text)) airports.push("HND");
  if (/成田|NRT/i.test(text)) airports.push("NRT");
  if (/松山|TSA/i.test(text)) airports.push("TSA");
  if (/桃園|TPE/i.test(text)) airports.push("TPE");
  return { airline: m[1].toUpperCase(), number: m[2], date, airports, match: m[0], index: m.index ?? 0 };
}
