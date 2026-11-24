// 信用卡推薦：規則在 supabase/functions/_shared/cards.ts（網頁和聊天機器人共用）；這裡只有網頁端的開關。
import { useSyncExternalStore } from "react";
import { lang, t } from "./i18n";
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
/**
 * 卡片庫裡的說明、條件、上限是大家用中文填的資料。每張卡另外帶一份「中文句子 → 英文」的對照（card_catalog.en，存檔後由 translate-card 自動補），
 * 英文畫面就查那份對照；還沒翻到的句子照原樣顯示中文。
 */
export const tx = (card: Pick["card"], s: string | undefined | null): string => (!s ? "" : lang === "en" ? card.en?.[s] ?? s : s);
const noteOf = (p: Pick) => (p.rate?.note ? t("（{note}）", { note: tx(p.card, p.rate.note) }) : "");
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

// ---- 刷卡小提醒跟著目的地走：原本整段是寫給日本的（日圓、Suica），去別的國家就不對 ----
/** 當地貨幣的說法（「日圓 JPY」）；不知道是哪一國就回 null。 */
export function currencyOf(dest: Country): string | null {
  return dest === "jp" ? t("日圓 JPY") : dest === "kr" ? t("韓元 KRW") : dest === "tw" ? t("新台幣 TWD") : dest === "us" ? t("美元 USD") : dest === "uk" ? t("英鎊 GBP") : null;
}
/** 某一類消費在目的地刷卡的一句提醒（推薦卡旁邊那一行）。日本用原本那幾句。 */
export function kindTip(kind: StopKind, dest: Country): string {
  if (dest === "jp") return KIND_TIP[kind];
  const cur = currencyOf(dest) ?? t("當地貨幣");
  if (kind === "food") return t("能刷卡時用這張，結帳選{cur}。", { cur });
  if (kind === "hotel") return KIND_TIP.hotel;
  if (kind === "shop") return t("機器問幣別一律選{cur}，不選自己國家的幣別。", { cur });
  if (kind === "sight") return t("買門票用這張；小攤位可能只收現金。");
  return dest === "uk" ? t("地鐵和公車直接感應這張卡進出站，進出用同一張。") : t("買車票、叫車用這張；有些售票機只收現金或當地交通卡。");
}
/** 「在某地刷卡的小提醒」裡只跟那個國家有關的幾條（收不收卡、交通怎麼付）。句子裡的 <b> 交給 tr。 */
export function localTips(dest: Country): string[] {
  if (dest === "jp") return [
    "日本 Visa／Mastercard／JCB 幾乎都收；<b>AmEx 和 Discover</b>（走 JCB 網路）在大店沒問題，小店、拉麵店常常不收，備一張 Visa/Mastercard。感應付款（Apple Pay 的 Visa/Mastercard/AmEx）便利商店、車站、連鎖店都能用。",
    "Apple Pay 的 Suica／PASMO 用美國、英國卡加值可以（Mastercard、AmEx 最穩；部分 Visa 會被拒）。免稅店退稅會看結帳那張卡；小店、神社、售票機常常只收現金。",
  ];
  if (dest === "uk") return [
    "英國幾乎到處都能刷卡，感應付款（卡片或手機）最普遍，不少店甚至不收現金。<b>AmEx</b> 在小店和市集攤位常常不收，備一張 Visa/Mastercard。",
    "倫敦地鐵和公車直接用感應信用卡或手機進出站，不用另外買票；每個人要用自己的卡，進出用同一張。餐廳帳單常常已經加了服務費，先看帳單再決定要不要給小費。",
  ];
  if (dest === "kr") return [
    "韓國刷卡很普遍，Visa／Mastercard 幾乎都收；<b>AmEx 和 JCB</b> 在小店不一定收。傳統市場和路邊攤多半收現金。",
    "交通卡 T-money 多半要用現金加值（便利商店、地鐵站的機器），外國信用卡通常不能加值。",
  ];
  if (dest === "us") return [
    "美國幾乎到處都能刷卡，Visa／Mastercard／AmEx 都普遍。餐廳的小費另外加在帳單上，刷卡時一起付。",
    "加油站的機器常常要輸入美國的郵遞區號，外國卡可能被拒；可以進店裡請店員先刷。",
  ];
  if (dest === "tw") return [
    "台灣的連鎖店、百貨、餐廳多半能刷卡，Visa／Mastercard／JCB 都普遍；夜市、小吃店、傳統市場多半只收現金。",
    "捷運和公車用悠遊卡最方便，在便利商店或捷運站用現金加值。",
  ];
  return ["各地收卡的情況不同：出發前查一下當地是不是普遍收 AmEx，並備一張 Visa/Mastercard 和一些現金。"];
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
