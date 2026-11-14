// 2026-11-15 審查時修的幾個純邏輯：航班文字解析、資訊頁圖片、指定「就是這一列」的篩選、AI 用量加總。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlightText, resolveDate } from "../supabase/functions/_shared/flightText";
import { sumUsage, startOfToday } from "../supabase/functions/_shared/usage";
import { droppedImages, imagePathsIn, stripForeignImages } from "../src/images";
import { whereDay } from "../src/dayEdit";
import { daysFor } from "../src/data";
import type { Day } from "../src/data";

test("航班文字：航空公司、班號、日期、機場", () => {
  const range = { start: "2026-12-26", end: "2027-01-02" };
  const f = parseFlightText("去 BR192 12/26 松山 07:15 → 羽田 T3 11:00（座位 42B）", range)!;
  assert.deepEqual([f.airline, f.number, f.date, f.airports], ["BR", "192", "2026-12-26", ["HND", "TSA"]]);
  // 跨年：1/2 是 2027 年
  assert.equal(parseFlightText("回 BR191 1/2 羽田 12:30 → 松山", range)!.date, "2027-01-02");
  assert.equal(resolveDate(12, 20, range), "2026-12-20"); // 行程開始前幾天也算同一年
  // 文字裡沒有日期：用那一天的日期（行程裡的飛機交通段）
  assert.equal(parseFlightText("JL 98 羽田 → 松山", range, "2026-12-30")!.date, "2026-12-30");
  assert.equal(parseFlightText("搭新幹線到長野", range), null);
  assert.equal(parseFlightText("BR192 沒寫日期", range), null);
});

test("資訊頁圖片：只認這個行程自己上傳的圖", () => {
  const T = "6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c";
  const mine = `https://x.supabase.co/storage/v1/object/public/info-images/${T}/abc123.jpg`;
  const other = "https://x.supabase.co/storage/v1/object/public/info-images/00000000-0000-0000-0000-000000000000/zzz.jpg";
  const body = `文字 ![關東煮](${mine}) 還有 ![別的行程](${other}) 和 ![外面的圖](https://evil.example/pixel.gif)`;
  assert.deepEqual(imagePathsIn(body, T), [`${T}/abc123.jpg`]);
  // 想用路徑跳出自己的資料夾：不算
  assert.deepEqual(imagePathsIn(`![x](https://x.supabase.co/storage/v1/object/public/info-images/${T}/../other/a.jpg)`, T), []);
  // 這一頁拿掉了圖、別頁也沒用到 → 要刪；別頁還在用 → 留著
  assert.deepEqual(droppedImages(body, "圖拿掉了", [], T), [`${T}/abc123.jpg`]);
  assert.deepEqual(droppedImages(body, "圖拿掉了", [`別頁 ![同一張](${mine})`], T), []);
  assert.deepEqual(droppedImages(body, body, [], T), []);
  // AI 的回答存成一頁：外面的圖拿掉（不然每個打開的人都會去載那個網址），自己上傳的留著
  const kept = stripForeignImages(body);
  assert.ok(kept.includes(mine) && kept.includes(other) && !kept.includes("evil.example"));
});

test("指定行程的某一天：用列的 id，不用「包含這一家」", () => {
  const calls: string[] = [];
  const q = { eq(c: string, v: string) { calls.push(`eq ${c}=${v}`); return q; }, is(c: string, v: null) { calls.push(`is ${c}=${v}`); return q; }, contains() { throw new Error("不該用 contains"); } };
  whereDay(q, "T", { rowId: "row-1", id: "2026-12-27", fam: ["lily"] });
  assert.deepEqual(calls, ["eq id=row-1"]);
  calls.length = 0;
  // 沒有列 id 時（舊的快取）：整個 fam 陣列要相等，{lily} 不會比對到 {yanzhi,lily}
  whereDay(q, "T", { id: "2026-12-27", fam: ["lily"] });
  assert.deepEqual(calls, ["eq trip_id=T", "eq date_id=2026-12-27", "eq fam={lily}"]);
  calls.length = 0;
  whereDay(q, "T", { id: "2026-12-27", fam: null });
  assert.deepEqual(calls, ["eq trip_id=T", "eq date_id=2026-12-27", "is fam=null"]);
});

test("一家看到的日子：自己的版本 > 和別家合併的 > 大家一起的", () => {
  const day = (fam: string[] | null, title: string): Day => ({ id: "2026-12-27", d: "12/27", w: "日", city: "東京", title, hotel: "", items: [], fam });
  const days = [day(null, "shared"), day(["yanzhi", "lily"], "joint"), day(["lily"], "own")];
  assert.equal(daysFor(days, "lily")[0].title, "own");
  assert.equal(daysFor(days, "yanzhi")[0].title, "joint");
  assert.equal(daysFor(days, "claire")[0].title, "shared");
});

test("AI 用量：照模型牌價加總", () => {
  // Sonnet：輸入 2、5 分鐘快取寫入 2.5、快取讀取 0.1、輸出 10（美金／百萬 token），搜尋每次 0.01
  const u = sumUsage("claude-sonnet-5-5", [
    { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20000, cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 0 } },
    { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 2 } },
  ]);
  assert.equal(u.calls, 2);
  assert.equal(u.searches, 2);
  assert.equal(u.usd, Math.round((1000 * 2 + 500 * 10 + 20000 * 0.1 + 4000 * 2.5) / 1e6 * 10000) / 10000 + 0.02);
  // Opus 比 Sonnet 貴一倍
  assert.equal(sumUsage("claude-opus-5-5", [{ input_tokens: 1_000_000, output_tokens: 0 }]).usd, 4);
  assert.equal(sumUsage("claude-haiku-5-5", [{ input_tokens: 0, output_tokens: 1_000_000 }]).usd, 0.5);
});

test("每日上限從行程當地的午夜起算", () => {
  const start = new Date(startOfToday("Asia/Tokyo"));
  // 東京的午夜是 UTC 15:00
  assert.equal(start.getUTCHours(), 15);
  assert.equal(start.getUTCMinutes(), 0);
  assert.ok(Date.now() - start.getTime() >= 0 && Date.now() - start.getTime() < 24 * 3600_000);
});
