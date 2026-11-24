// 信用卡推薦：規則在 supabase/functions/_shared/cards.ts（網頁和聊天機器人共用）；這裡只有網頁端的開關。
import { useSyncExternalStore } from "react";
import { t } from "./i18n";
import * as shared from "../supabase/functions/_shared/cards";
import type { Country, Pick, RateKind, RateWhere, StopKind } from "../supabase/functions/_shared/cards";

export * from "../supabase/functions/_shared/cards";
export type { Card, CardRate, Country, Pick, RateKind, RateWhere, StopKind } from "../supabase/functions/_shared/cards";

// ---- 畫面上的字跟著語言走：規則檔是網頁和 Edge Function 共用的（不能 import i18n），所以在這裡蓋掉要顯示的那幾個名稱和說明 ----
// （本檔自己 export 的名字優先於上面的 export *，所以從 "../cards" import 的元件拿到的就是翻好的。）
const each = <K extends string>(m: Record<K, string>) => Object.fromEntries(Object.entries<string>(m).map(([k, v]) => [k, t(v)])) as Record<K, string>;
export const COUNTRY_NAME: Record<Country, string> = each(shared.COUNTRY_NAME);
export const WHERE_NAME: Record<RateWhere, string> = each(shared.WHERE_NAME);
export const RATE_KIND_NAME: Record<RateKind, string> = each(shared.RATE_KIND_NAME);
export const NETWORK_NAME: Record<string, string> = each(shared.NETWORK_NAME);
export const KIND_TIP: Record<StopKind, string> = each(shared.KIND_TIP);
const noteOf = (p: Pick) => (p.rate?.note ? t("（{note}）", { note: p.rate.note }) : "");
/** 一句話說為什麼（跟共用規則裡的 explain 同一句，只是跟著語言走）。 */
export function explain(p: Pick): string {
  if (!p.rate) return p.fee ? t("沒有適用的回饋，手續費 {fee}", { fee: shared.pct(p.fee) }) : t("沒有適用的回饋");
  return p.fee ? t("回饋 {rate}{note} − 手續費 {fee} ＝ 淨 {net}", { rate: shared.pct(p.rate.rate), note: noteOf(p), fee: shared.pct(p.fee), net: shared.pct(p.net) }) : t("回饋 {rate}{note}", { rate: shared.pct(p.rate.rate), note: noteOf(p) });
}
/** explain 去掉「＝ 淨 …」那一段（卡片庫搜尋結果用的短版）。 */
export function explainShort(p: Pick): string {
  if (!p.rate || !p.fee) return explain(p);
  return t("回饋 {rate}{note} − 手續費 {fee}", { rate: shared.pct(p.rate.rate), note: noteOf(p), fee: shared.pct(p.fee) });
}

// ---- 「每一站顯示推薦的卡」開關（預設開），記在這台裝置 ----
const KEY = "jp-cards-on";
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export function setCardsOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useCardsOn(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, read, () => true);
}
