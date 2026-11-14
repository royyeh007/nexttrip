// 信用卡推薦規則：用真正的種子資料（seed/cards.json）跑 rank()，確認幾個應該成立的事實。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countryOf, rank, summary } from "../supabase/functions/_shared/cards";
import type { Card } from "../supabase/functions/_shared/cards";

const cards = JSON.parse(readFileSync("seed/cards.json", "utf8")) as Card[];
const by = (id: string) => { const c = cards.find((x) => x.id === id); if (!c) throw new Error(`no card ${id}`); return c; };

test("目的地判斷", () => {
  assert.equal(countryOf("日本・東京、長野、輕井澤、草津"), "jp");
  assert.equal(countryOf("台灣・台北"), "tw");
  assert.equal(countryOf("英國 London"), "uk");
});

test("美國卡在日本：沒有手續費的旅遊卡贏過回饋高但收 3% 的卡", () => {
  const us = [by("chase-sapphire-preferred"), by("citi-double-cash"), by("capital-one-venture-x"), by("apple-card")];
  const food = rank(us, "food", "jp", "2026-12-28");
  assert.equal(food[0].card.id, "chase-sapphire-preferred");
  assert.equal(food[0].net, 3.75);
  assert.equal(food.find((p) => p.card.id === "citi-double-cash")!.net, -1);
  const all = rank(us, "all", "jp");
  assert.deepEqual(all.slice(0, 2).map((p) => p.card.id), ["capital-one-venture-x", "apple-card"]);
});

test("美國卡在美國：不收海外手續費", () => {
  const us = [by("chase-sapphire-preferred"), by("citi-double-cash"), by("capital-one-venture-x"), by("apple-card")];
  const home = rank(us, "all", "us");
  assert.ok(home.every((p) => p.fee === 0));
  assert.deepEqual(home.slice(0, 2).map((p) => p.card.id), ["capital-one-venture-x", "citi-double-cash"]);
});

test("英國卡在日本和在英國", () => {
  const uk = [by("barclaycard-rewards"), by("ba-amex-premium-plus"), by("halifax-clarity"), by("santander-edge-credit")];
  const all = rank(uk, "all", "jp");
  assert.deepEqual(all.slice(0, 2).map((p) => p.card.id), ["santander-edge-credit", "barclaycard-rewards"]);
  assert.equal(all.find((p) => p.card.id === "ba-amex-premium-plus")!.net, -1.74);
  assert.equal(all.find((p) => p.card.id === "halifax-clarity")!.net, 0);
  assert.equal(rank([by("chase-uk-debit")], "all", "uk")[0].net, 1);
  assert.equal(rank([by("chase-uk-debit")], "all", "jp")[0].net, 0);
});

test("台灣卡：優惠到期後照算但標成 stale", () => {
  const tw = [by("cathay-cube"), by("esun-only"), by("fubon-j")];
  const dec = rank(tw, "shop", "jp", "2026-12-28"), jan = rank(tw, "shop", "jp", "2027-01-01");
  assert.equal(dec[0].card.id, "fubon-j");
  assert.equal(dec[0].net, 4.5);
  assert.equal(dec[0].stale, false);
  assert.equal(jan[0].card.id, "fubon-j");
  assert.equal(jan[0].stale, true);
  assert.equal(dec.find((p) => p.card.id === "esun-only")!.net, -0.5);
});

test("每張種子卡、每一類都算得出數字", () => {
  for (const c of cards) for (const k of ["all", "food", "hotel", "shop", "sight", "move"] as const) {
    assert.ok(Number.isFinite(rank([c], k, "jp", "2026-12-28")[0].net), `${c.id} ${k}`);
  }
  assert.ok(summary(cards.slice(0, 3), "jp", "2026-12-26").includes("→"));
});

test("卡片庫裡的壞資料不會讓排序丟例外", () => {
  // rates 不是陣列、裡面有 null、回饋不是數字、沒有名字：這些都可能被別人寫進共用的卡片庫
  const broken = [
    { ...by("apple-card"), id: "x1", rates: "oops" },
    { ...by("apple-card"), id: "x2", rates: [null, { where: "overseas", kind: "all", rate: "abc" }, { where: "overseas", kind: "all", rate: 2 }] },
    { ...by("apple-card"), id: "x3", name: undefined, fx_fee: "3" },
  ] as unknown as Card[];
  const picks = rank(broken, "all", "jp");
  assert.equal(picks.length, 3);
  assert.ok(picks.every((p) => Number.isFinite(p.net)));
  assert.equal(picks.find((p) => p.card.id === "x1")!.rate, null);
  assert.equal(picks.find((p) => p.card.id === "x2")!.rate?.rate, 2);
});
