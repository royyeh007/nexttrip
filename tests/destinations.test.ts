// 隨機推薦目的地。
import test from "node:test";
import assert from "node:assert/strict";
import { DESTINATIONS, DEST_TAGS, REGIONS, pickDestination } from "../src/destinations";

test("清單：名稱不重複，每個都有地區、標籤、中英文說明，英文裡沒有中文", () => {
  assert.equal(new Set(DESTINATIONS.map((d) => d.zh)).size, DESTINATIONS.length);
  for (const d of DESTINATIONS) {
    assert.ok(REGIONS.includes(d.region) && d.tags.length > 0 && d.tags.every((t) => DEST_TAGS.includes(t)), d.zh);
    assert.ok(d.whyZh && d.whyEn && !/[一-鿿]/.test(d.en + d.whyEn), d.zh);
  }
  for (const r of REGIONS) assert.ok(DESTINATIONS.some((d) => d.region === r), r);
});
test("什麼都不填也抽得到；rand 決定抽哪一個", () => {
  assert.equal(pickDestination({}, undefined, () => 0)?.zh, DESTINATIONS[0].zh);
  assert.equal(pickDestination({}, undefined, () => 0.9999)?.zh, DESTINATIONS[DESTINATIONS.length - 1].zh);
});
test("地區和想玩什麼都要符合", () => {
  for (let i = 0; i < 50; i++) { const d = pickDestination({ region: "europe", tags: ["beach", "history"] }, undefined, () => i / 50)!; assert.equal(d.region, "europe"); assert.ok(d.tags.includes("beach") && d.tags.includes("history")); }
});
test("都符合的沒有：放寬成符合任何一項", () => {
  const none = DESTINATIONS.filter((x) => x.region === "oceania" && x.tags.includes("snow") && x.tags.includes("history"));
  assert.equal(none.length, 0);
  for (let i = 0; i < 20; i++) { const d = pickDestination({ region: "oceania", tags: ["snow", "history"] }, undefined, () => i / 20)!; assert.ok(d.region === "oceania" && (d.tags.includes("snow") || d.tags.includes("history"))); }
});
test("清單夠大：至少 177 個，每個地區至少 15 個", () => {
  assert.ok(DESTINATIONS.length >= 177, String(DESTINATIONS.length));
  for (const r of REGIONS) assert.ok(DESTINATIONS.filter((d) => d.region === r).length >= 15, r);
});
test("再抽一次不會抽到同一個（只剩一個時除外）", () => {
  const first = pickDestination({}, undefined, () => 0)!;
  assert.notEqual(pickDestination({}, first.zh, () => 0)!.zh, first.zh);
  assert.equal(pickDestination({ region: "other", tags: ["city", "beach", "nature"] }, "南非・開普敦", () => 0)?.zh, "巴西・里約熱內盧");
});
