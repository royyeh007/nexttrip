// 誰會去：一次代填好幾位，把一串名字拆成人。
import test from "node:test";
import assert from "node:assert/strict";
import { parseGuests } from "../src/people";

const P = (s: string) => parseGuests(s).map((g) => `${g.name}/${g.kind}/${g.age ?? "-"}`).join(" ");

test("頓號、逗號、換行都可以分開；沒寫的是大人", () => {
  assert.equal(P("Yenchih、Amie，Tim, Claire\n阿明；小美"), "Yenchih/adult/- Amie/adult/- Tim/adult/- Claire/adult/- 阿明/adult/- 小美/adult/-");
});
test("名字後面的年齡：小孩", () => {
  assert.equal(P("小宇 9 歲、安安9歲、妹妹（7）、Leo 11y, Mia 3 years old、弟弟 5"), "小宇/child/9 安安/child/9 妹妹/child/7 Leo/child/11 Mia/child/3 弟弟/child/5");
});
test("寫小孩或大人；18 以上算大人", () => {
  assert.equal(P("小宇 小孩、阿公 大人、Ben (child)、哥哥 18 歲"), "小宇/child/- 阿公/adult/- Ben/child/- 哥哥/adult/-");
});
test("空的、只有符號的跳過；名字裡的數字留著；最多 20 位", () => {
  assert.equal(P(" 、， \n"), "");
  assert.equal(P("9"), "9/adult/-");
  assert.equal(P("R2D2 小孩、R2D2"), "R2D2/child/- R2D2/adult/-");
  assert.equal(parseGuests(Array.from({ length: 30 }, (_, i) => "人" + String.fromCharCode(65 + i)).join("、")).length, 20);
});

test("每一家至少要有一個人去：找出一個人都沒去的那幾家", async () => {
  const { familiesWithNobody } = await import("../src/people");
  const all = [{ id: "a1", family_id: "a" }, { id: "a2", family_id: "a" }, { id: "b1", family_id: "b" }];
  assert.deepEqual(familiesWithNobody(all, undefined), []);
  assert.deepEqual(familiesWithNobody(all, ["a1", "b1"]), []);
  assert.deepEqual(familiesWithNobody(all, ["a1", "a2"]), ["b"]);
  assert.deepEqual(familiesWithNobody(all, []), ["a", "b"]);
  assert.deepEqual(familiesWithNobody(all, ["zz"]), ["a", "b"]);
});
