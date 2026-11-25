// 一天裡的地點照時間排：加一站、改時間、取消分頭行動之後都靠這個函式。
import test from "node:test";
import assert from "node:assert/strict";
import { sortByTime } from "../src/dayEdit";
import type { Item } from "../src/data";

const stop = (t: string, n: string, par?: string) => ({ t, n, q: n, k: "sight", ...(par ? { par } : {}) }) as Item;
const leg = (txt: string) => ({ leg: "walk", txt }) as Item;
const names = (items: Item[]) => items.map((it) => ("leg" in it ? `(${it.txt})` : it.n)).join(" ");

test("早上的站排到傍晚的站前面", () => {
  assert.equal(names(sortByTime([stop("17:00", "晚餐"), stop("5:07", "早起")])), "早起 晚餐");
});

test("到站的交通跟著那一站走", () => {
  assert.equal(names(sortByTime([stop("9:00", "A"), leg("到C"), stop("15:00", "C"), leg("到B"), stop("12:00", "B")])), "A (到B) B (到C) C");
});

test("有一站沒寫時間，其他站照樣排；沒時間的留在它原本跟著的那一站後面", () => {
  assert.equal(names(sortByTime([stop("17:00", "晚餐"), stop("", "逛街"), stop("5:07", "早起")])), "早起 晚餐 逛街");
  assert.equal(names(sortByTime([stop("", "待定"), stop("17:00", "晚餐"), stop("9:00", "早餐")])), "待定 早餐 晚餐");
});

test("分頭行動的幾站留在一起，整組照最早的時間排", () => {
  assert.equal(names(sortByTime([stop("14:00", "下午"), stop("10:30", "大人", "p1"), stop("10:00", "小孩", "p1"), stop("8:00", "早餐")])), "早餐 大人 小孩 下午");
});

test("同一個時間的站維持原本的先後", () => {
  assert.equal(names(sortByTime([stop("16:00", "甲"), stop("16:00", "乙"), stop("9:00", "丙")])), "丙 甲 乙");
});
