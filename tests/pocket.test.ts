import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PHOTOS, PHOTO_SOURCE_MAX_BYTES, categoriesOf, findInPocket, groupPlaces, matchPlace, photoProblem, placeFromStop, plainName, pocketKey, shareCodeOf, stopFromPlace } from "../src/pocket";
import type { PocketPlace } from "../src/pocket";
import type { Stop } from "../src/data";

const place = (o: Partial<PocketPlace>): PocketPlace => ({ id: o.name ?? "x", name: "x", kind: "food", category: "", city: "", q: "", addr: "", tel: "", s: "", note: "", details: {}, photos: [], created_at: "", updated_at: "", ...o });

test("口袋名單：行程的地點存進來，餐別拿掉、訂位和備註不帶", () => {
  const stop: Stop = { t: "12:00", n: "午餐：澤村 Sawamura", q: "澤村 輕井澤", k: "food", st: "ok", s: "麵包名店", addr: "長野県軽井沢町", tel: "0267-00-0000", book: ["訂位編號 ABC12345"], rec: ["法式吐司"], tips: ["排隊"], memo: [{ by: "u", name: "Roy", text: "記得帶錢", at: "2026-01-01" }], people: ["p1"], ll: [36.3, 138.6], sid: "s1" };
  const p = placeFromStop(stop, "輕井澤");
  assert.equal(p.name, "澤村 Sawamura");
  assert.equal(p.city, "輕井澤");
  assert.equal(p.kind, "food");
  assert.equal(p.note, "");
  assert.deepEqual(p.details, { rec: ["法式吐司"], tips: ["排隊"], ll: [36.3, 138.6] });
  assert.ok(!JSON.stringify(p).includes("ABC12345"), "訂位編號不能帶到口袋名單");
  assert.ok(!JSON.stringify(p).includes("記得帶錢"), "行程裡的備註不帶");
});

test("口袋名單：加到行程變回一站，備註和照片不帶", () => {
  const p = place({ name: "一蘭拉麵", kind: "food", addr: "東京都渋谷区", tel: "03-1", s: "豚骨", note: "我的私人備註", photos: ["u/abc.jpg"], details: { rec: ["加麵"], ll: [35.6, 139.7] } });
  const s = stopFromPlace(p, " 18:30 ");
  assert.deepEqual(s, { t: "18:30", n: "一蘭拉麵", k: "food", q: "一蘭拉麵 東京都渋谷区", s: "豚骨", addr: "東京都渋谷区", tel: "03-1", rec: ["加麵"], ll: [35.6, 139.7] });
  assert.equal(stopFromPlace(place({ name: "清水寺", q: "清水寺 京都" })).q, "清水寺 京都");
  assert.equal(stopFromPlace(place({ name: "清水寺" })).t, "");
});

test("口袋名單：同一個地點用名字認（不管大小寫、空白、餐別）", () => {
  assert.equal(plainName("晚餐：一蘭"), "一蘭");
  assert.equal(pocketKey("Sawamura  Bakery"), pocketKey("午餐：sawamura bakery"));
  const list = [place({ name: "澤村 Sawamura" }), place({ name: "清水寺" })];
  assert.equal(findInPocket(list, "午餐：澤村Sawamura")?.name, "澤村 Sawamura");
  assert.equal(findInPocket(list, "金閣寺"), undefined);
  assert.equal(findInPocket(list, "  "), undefined);
});

test("口袋名單：分組和分類", () => {
  const list = [place({ name: "B 甜點", category: "甜點", kind: "food", city: "京都" }), place({ name: "A 甜點", category: "甜點", kind: "food", city: "東京" }), place({ name: "寺", category: "", kind: "sight", city: "京都" }), place({ name: "店", category: "伴手禮", kind: "shop", city: "" })];
  assert.deepEqual(categoriesOf(list), ["甜點", "伴手禮"]);
  const byCat = groupPlaces(list, "category");
  assert.deepEqual(byCat.map((g) => g.key), ["伴手禮", "甜點", ""], "沒分類的排最後");
  assert.deepEqual(byCat[1].items.map((p) => p.name), ["A 甜點", "B 甜點"]);
  assert.deepEqual(groupPlaces(list, "kind").map((g) => g.key), ["food", "sight", "shop"]);
  assert.deepEqual(groupPlaces(list, "city").map((g) => g.key).at(-1), "");
});

test("口袋名單：搜尋", () => {
  const p = place({ name: "一蘭拉麵", category: "宵夜", city: "東京", note: "24 小時" });
  assert.ok(matchPlace(p, ""));
  assert.ok(matchPlace(p, "東京 拉麵"));
  assert.ok(matchPlace(p, "24"));
  assert.ok(!matchPlace(p, "京都"));
});

test("口袋名單：照片最多三張、太大或不是照片就擋下來", () => {
  const ok = { name: "a.jpg", type: "image/jpeg", size: 3_000_000 };
  assert.equal(photoProblem(ok, 0), null);
  assert.equal(photoProblem(ok, MAX_PHOTOS - 1), null);
  assert.match(photoProblem(ok, MAX_PHOTOS) ?? "", /最多 3 張/);
  assert.match(photoProblem({ name: "a.heic", type: "", size: 10 }, 0) ?? "", /HEIC/);
  assert.match(photoProblem({ name: "a.pdf", type: "application/pdf", size: 10 }, 0) ?? "", /只能放照片/);
  assert.match(photoProblem({ ...ok, size: PHOTO_SOURCE_MAX_BYTES + 1 }, 0) ?? "", /太大/);
});

test("口袋名單：分享連結或代碼都能讀出代碼", () => {
  assert.equal(shareCodeOf("https://x.github.io/nexttrip/#pocket=AB12cd34ef56ab78"), "ab12cd34ef56ab78");
  assert.equal(shareCodeOf("  ab12cd34ef56ab78 "), "ab12cd34ef56ab78");
});
