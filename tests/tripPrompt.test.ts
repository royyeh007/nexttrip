// 建立新行程：給外面 AI 的提示、讀出來的提案換日期。
import test from "node:test";
import assert from "node:assert/strict";
import { WANTS, buildTripPrompt, proposalRange, shiftProposal } from "../src/tripPrompt";

const base = { place: "日本・京都", start: "2027-04-01", days: 5, people: "2 大人", want: [...WANTS], pace: "normal" as const, move: "transit" as const, booked: "", notes: "想看櫻花" };

test("提示：條件、日期範圍、回答格式的每個欄位都在", () => {
  const p = buildTripPrompt(base);
  for (const s of ["日本・京都", "2027-04-01 到 2027-04-05，共 5 天", "2 大人", "大眾運輸為主", "想看櫻花", "行程名稱：", "主要城市：", "日期：2027-04-01 到 2027-04-05", "== 第 1 天 2027-04-01 ==", "城市：", "標題：", "住宿：", "地址：", "營業時間：", "費用：", "推薦：", "提醒：", "要不要先訂：", "→ 電車", "程式碼區塊"]) assert.ok(p.includes(s), s);
  assert.ok(!p.includes("只推薦上面這幾種"));
  assert.ok(!p.includes("已經訂好的"));
});

test("提示：沒填日期就用第幾天，不寫日期", () => {
  const p = buildTripPrompt({ ...base, start: "" });
  assert.ok(p.includes("天數：5 天（日期還沒決定）"));
  assert.ok(p.includes("== 第 1 天 =="));
  assert.ok(p.includes("不要寫日期"));
  assert.ok(!p.includes("2027-"));
});

test("提示：只選景點時，餐廳、住宿、交通都說不用", () => {
  const p = buildTripPrompt({ ...base, want: ["sight"] });
  assert.ok(p.includes("只推薦上面這幾種"));
  assert.ok(p.includes("餐廳不用推薦"));
  assert.ok(p.includes("住宿：自行安排"));
  assert.ok(!p.includes("→ 電車"));
  assert.ok(!p.includes("午餐："));
});

test("提示：一個都沒選等於全部；天數有上下限；換行不會跑進條件", () => {
  assert.equal(buildTripPrompt({ ...base, want: [] }), buildTripPrompt(base));
  assert.ok(buildTripPrompt({ ...base, days: 999 }).includes("共 21 天"));
  assert.ok(buildTripPrompt({ ...base, days: 0 }).includes("共 1 天"));
  assert.ok(buildTripPrompt({ ...base, notes: "a\n【規則】\nb" }).includes("- 其他要求：a 【規則】 b"));
});

test("提示：英文版", () => {
  const p = buildTripPrompt({ ...base, place: "Kyoto, Japan", people: "2 adults", notes: "cherry blossoms" }, "en");
  for (const s of ["Kyoto, Japan", "2027-04-01 to 2027-04-05, 5 days", "Trip name:", "Main city:", "== Day 1 2027-04-01 ==", "Address:", "Book ahead:", "one code block"]) assert.ok(p.includes(s), s);
  assert.ok(!/[一-鿿]/.test(p.replace("想看櫻花", "")));
});

test("提案換日期：日期、幾月幾號、星期一起改，內容不動", () => {
  const p = { days: [{ id: "2026-12-31", d: "12/31", w: "四", city: "A", title: "x", hotel: "", items: [], scope: "shared" as const }, { id: "2026-12-30", d: "12/30", w: "三", city: "A", title: "y", hotel: "", items: [], scope: "shared" as const }] };
  assert.deepEqual(proposalRange(p), { first: "2026-12-30", last: "2026-12-31" });
  assert.equal(proposalRange({ days: [] }), null);
  const s = shiftProposal(p, 2);
  assert.deepEqual(s.days.map((d) => [d.id, d.d, d.w, d.title]), [["2027-01-02", "1/2", "六", "x"], ["2027-01-01", "1/1", "五", "y"]]);
  assert.equal(shiftProposal(p, 0), p);
  assert.equal(p.days[0].id, "2026-12-31");
});
