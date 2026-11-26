// 首頁的行程清單：每個行程現在是「還沒開始 / 進行中 / 已結束」，以及清單怎麼排、怎麼搜尋。
// 純邏輯，不碰畫面，tests/tripList.test.ts 在測。
import { daysBetween } from "./data";

export interface TripDates { name: string; start_date: string; end_date: string; place?: string; tz?: string }

export type TripPhase = "now" | "soon" | "past";
/** phase 加上要顯示的數字：soon = 還有幾天出發，now = 今天是第幾天，past = 結束幾天了。 */
export interface TripStatus { phase: TripPhase; days: number; length: number }

/** `today` 是 YYYY-MM-DD（行程所在時區的今天）。 */
export function tripStatus(trip: TripDates, today: string): TripStatus {
  const length = daysBetween(trip.start_date, trip.end_date) + 1;
  if (today < trip.start_date) return { phase: "soon", days: daysBetween(today, trip.start_date), length };
  if (today > trip.end_date) return { phase: "past", days: daysBetween(trip.end_date, today), length };
  return { phase: "now", days: daysBetween(trip.start_date, today) + 1, length };
}

/** 某個時區的今天；時區名稱不認得就用這台裝置的日期。 */
export function todayIn(tz: string | undefined, at: Date = new Date()): string {
  try { return at.toLocaleString("sv-SE", { timeZone: tz || undefined }).slice(0, 10); }
  catch { return at.toLocaleString("sv-SE").slice(0, 10); }
}

export type TripSort = "time" | "newest" | "recent" | "name";
export const TRIP_SORTS: TripSort[] = ["time", "newest", "recent", "name"];

const PHASE_ORDER: Record<TripPhase, number> = { now: 0, soon: 1, past: 2 };

/**
 * time   = 進行中 → 還沒開始（最快出發的在前）→ 已結束（最近結束的在前）
 * newest = 出發日新的在前
 * recent = 最近開過的在前
 * name   = 照名稱
 */
export function sortTrips<T extends { trip: TripDates; last_opened_at?: string | null }>(list: T[], mode: TripSort, todayOf: (t: TripDates) => string): T[] {
  const out = [...list];
  const byStart = (a: T, b: T) => a.trip.start_date.localeCompare(b.trip.start_date) || a.trip.name.localeCompare(b.trip.name);
  if (mode === "name") return out.sort((a, b) => a.trip.name.localeCompare(b.trip.name, undefined, { numeric: true }) || byStart(a, b));
  if (mode === "newest") return out.sort((a, b) => byStart(b, a));
  if (mode === "recent") return out.sort((a, b) => (b.last_opened_at ?? "").localeCompare(a.last_opened_at ?? "") || byStart(a, b));
  return out.sort((a, b) => {
    const pa = tripStatus(a.trip, todayOf(a.trip)).phase, pb = tripStatus(b.trip, todayOf(b.trip)).phase;
    if (pa !== pb) return PHASE_ORDER[pa] - PHASE_ORDER[pb];
    return pa === "past" ? b.trip.end_date.localeCompare(a.trip.end_date) || byStart(a, b) : byStart(a, b);
  });
}

/** 搜尋：名稱、城市、日期（2026、12.28、2026-12 都可以），空白隔開的每個字都要有。 */
export function matchTrip(trip: TripDates, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const dots = (iso: string) => iso.replace(/-0?/g, ".");
  const hay = [trip.name, trip.place ?? "", trip.start_date, trip.end_date, dots(trip.start_date), dots(trip.end_date), trip.start_date.replace(/-/g, "/"), trip.end_date.replace(/-/g, "/")].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}
