// 首頁的行程清單：狀態（還沒開始 / 進行中 / 已結束）、排序、搜尋。
import test from "node:test";
import assert from "node:assert/strict";
import { matchTrip, sortTrips, todayIn, tripStatus } from "../src/tripList";

const trip = (name: string, start_date: string, end_date: string, place = "") => ({ name, start_date, end_date, place });
const row = (name: string, s: string, e: string, opened = "") => ({ trip: trip(name, s, e), last_opened_at: opened });
const TODAY = "2026-11-26";
const names = (l: { trip: { name: string } }[]) => l.map((m) => m.trip.name).join(" ");

test("狀態：還沒開始的算還有幾天", () => {
  assert.deepEqual(tripStatus(trip("日本", "2026-12-26", "2027-01-03"), TODAY), { phase: "soon", days: 30, length: 9 });
  assert.equal(tripStatus(trip("明天", "2026-11-27", "2026-11-28"), TODAY).days, 1);
});

test("狀態：開始那天和結束那天都算進行中", () => {
  assert.deepEqual(tripStatus(trip("感恩節", "2026-11-25", "2026-11-29"), TODAY), { phase: "now", days: 2, length: 5 });
  assert.equal(tripStatus(trip("今天出發", TODAY, "2026-11-30"), TODAY).phase, "now");
  assert.deepEqual(tripStatus(trip("今天結束", "2026-11-20", TODAY), TODAY), { phase: "now", days: 7, length: 7 });
});

test("狀態：結束隔天就算已結束", () => {
  assert.deepEqual(tripStatus(trip("上週", "2026-11-20", "2026-11-25"), TODAY), { phase: "past", days: 1, length: 6 });
});

test("照時間：進行中 → 快出發的 → 最近結束的", () => {
  const list = [row("去年", "2025-07-01", "2025-07-10"), row("明年", "2027-04-01", "2027-04-08"), row("上個月", "2026-10-01", "2026-10-05"), row("下個月", "2026-12-26", "2027-01-03"), row("現在", "2026-11-25", "2026-11-29")];
  assert.equal(names(sortTrips(list, "time", () => TODAY)), "現在 下個月 明年 上個月 去年");
});

test("其他排法：出發日新到舊、最近開過、名稱", () => {
  const list = [row("B", "2026-01-01", "2026-01-02", "2026-11-01"), row("A", "2027-01-01", "2027-01-02", "2026-11-20"), row("C", "2025-01-01", "2025-01-02", "")];
  assert.equal(names(sortTrips(list, "newest", () => TODAY)), "A B C");
  assert.equal(names(sortTrips(list, "recent", () => TODAY)), "A B C");
  assert.equal(names(sortTrips([...list].reverse(), "name", () => TODAY)), "A B C");
});

test("排序不動原本的陣列", () => {
  const list = [row("B", "2027-01-01", "2027-01-02"), row("A", "2026-12-01", "2026-12-02")];
  sortTrips(list, "time", () => TODAY);
  assert.equal(names(list), "B A");
});

test("搜尋：名稱、城市、日期，不分大小寫，每個字都要有", () => {
  const t = trip("2026 Japan 跨年", "2026-12-26", "2027-01-03", "長野, 日本");
  assert.ok(matchTrip(t, ""));
  assert.ok(matchTrip(t, "japan"));
  assert.ok(matchTrip(t, "長野"));
  assert.ok(matchTrip(t, "12.26"));
  assert.ok(matchTrip(t, "2027"));
  assert.ok(matchTrip(t, "跨年 日本"));
  assert.ok(!matchTrip(t, "京都"));
  assert.ok(!matchTrip(t, "japan 京都"));
});

test("今天是哪一天要看行程的時區", () => {
  const at = new Date("2026-11-26T20:00:00Z");
  assert.equal(todayIn("Asia/Tokyo", at), "2026-11-27");
  assert.equal(todayIn("America/Los_Angeles", at), "2026-11-26");
  assert.equal(todayIn("Not/AZone", at).length, 10);
});
