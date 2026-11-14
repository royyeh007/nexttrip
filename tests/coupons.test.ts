// 藥妝優惠券和「找附近的藥妝」：券圖都在、品牌認得出來、預載的店家清單在行程會去的地方找得到店。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { COUPONS, webpOf, bakedShops, couponFor, distText, expired } from "../src/coupons";

test("每張券都有圖（WebP 和 JPEG 各一）或網址", () => {
  for (const c of COUPONS) {
    assert.ok(c.img || c.url, c.id);
    if (!c.img) continue;
    assert.ok(existsSync(`public/${c.img}`), `${c.id} jpg`);
    assert.ok(existsSync(`public/${webpOf(c)}`), `${c.id} webp`);
    // 預載全部券圖只該花一兩 MB：WebP 一張超過 400 KB 就是壓錯了
    assert.ok(statSync(`public/${webpOf(c)}`).size < 400_000, `${c.id} webp 太大`);
    // 檔頭真的是 WebP（RIFF....WEBP）和 JPEG（FF D8）
    const head = readFileSync(`public/${webpOf(c)}`).subarray(0, 12);
    assert.equal(head.subarray(0, 4).toString("latin1") + head.subarray(8, 12).toString("latin1"), "RIFFWEBP", `${c.id} 不是 WebP`);
    assert.deepEqual([...readFileSync(`public/${c.img}`).subarray(0, 2)], [0xff, 0xd8], `${c.id} 不是 JPEG`);
  }
});

test("旅行期間沒有一張過期", () => {
  assert.deepEqual(COUPONS.filter((c) => expired(c, "2027-01-02")).map((c) => c.id), []);
});

test("從 OpenStreetMap 的店名認出是哪一家的券", () => {
  const cases: [string, string | undefined][] = [
    ["マツモトキヨシ 銀座5th店", "matsukiyo"], ["ドン・キホーテ 銀座本館", "donki"], ["スギ薬局", "sugi"], ["トモズ銀座3丁目店", "tomods"],
    ["ウエルシア薬局 welcia", "welcia"], ["くすりの福太郎", "fukutaro"], ["ココカラファイン", "cocokara"], ["サンドラッグ", "sundrug"], ["ビックカメラ 有楽町店", "bic"],
    ["クスリのアオキ", undefined], ["日本調剤", undefined], ["CHANEL", undefined], ["スギ花粉", undefined],
  ];
  for (const [name, id] of cases) assert.equal(couponFor(name)?.id, id, name);
});

test("距離文字", () => {
  assert.equal(distText(84), "80 公尺");
  assert.equal(distText(1234), "1.2 公里");
});

test("預載的店家清單：銀座、新橋、長野站附近找得到可以用券的店", () => {
  const baked = JSON.parse(readFileSync("public/coupons/shops.json", "utf8"));
  assert.ok(baked.shops.length > 2000, `${baked.shops.length} 家`);
  const ginza = bakedShops(baked, { lat: 35.6717, lon: 139.765 }, 800);
  assert.ok(ginza.some((s) => s.coupon!.id === "matsukiyo"));
  assert.ok(ginza.some((s) => s.coupon!.id === "donki"));
  assert.ok(ginza.every((s, i) => s.coupon && s.dist <= 800 && (i === 0 || ginza[i - 1].dist <= s.dist)), "依距離排序、都在半徑內、都有券");
  // COSMOS 只有兩家東京分店收券，附近搜尋不列（不然郊區分店會誤導）
  assert.ok(ginza.every((s) => s.coupon!.id !== "cosmos"));
  assert.ok(bakedShops(baked, { lat: 35.6628, lon: 139.7617 }, 800).length > 0, "新橋");
  assert.ok(bakedShops(baked, { lat: 36.643, lon: 138.1887 }, 800).length > 0, "長野站");
});
