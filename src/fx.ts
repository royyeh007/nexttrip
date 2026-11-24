// 匯率換算：匯率來自公開的 currency-api（每天更新一次，不用金鑰；只下載一份匯率表，不送出任何個人資料）。
// 下載到的匯率表存在這支手機上，所以在國外沒有網路時還能用上一次的匯率換算。
import { lang, t } from "./i18n";
import type { Country } from "./cards";

export interface Rates { date: string; at: number; usd: Record<string, number> }
/** 常用的幾種貨幣；名稱跟著語言走。 */
export const CURRENCIES: { code: string; name: string }[] = [
  { code: "TWD", name: t("新台幣") }, { code: "USD", name: t("美元") }, { code: "JPY", name: t("日圓") }, { code: "KRW", name: t("韓元") },
  { code: "GBP", name: t("英鎊") }, { code: "EUR", name: t("歐元") }, { code: "CNY", name: t("人民幣") }, { code: "HKD", name: t("港幣") },
  { code: "SGD", name: t("新加坡幣") }, { code: "THB", name: t("泰銖") }, { code: "VND", name: t("越南盾") }, { code: "MYR", name: t("馬來西亞幣") },
  { code: "AUD", name: t("澳幣") }, { code: "CAD", name: t("加幣") }, { code: "CHF", name: t("瑞士法郎") },
];
const known = (c: string | null | undefined): c is string => !!c && CURRENCIES.some((x) => x.code === c);
/** 目的地用的貨幣（不知道是哪一國先給歐元，使用者可以自己換）。 */
export const destCurrency = (dest: Country) => (dest === "jp" ? "JPY" : dest === "kr" ? "KRW" : dest === "tw" ? "TWD" : dest === "us" ? "USD" : dest === "uk" ? "GBP" : "EUR");

const HOME = "jp-fx-home", LOCAL = "jp-fx-local:", CACHE = "jp-cache:fx";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
/** 自己國家的貨幣：選過就記住；沒選過就看手機的地區（台灣→新台幣、美國→美元…），猜不到中文介面給新台幣、英文給美元。 */
export function homeCurrency(): string {
  const saved = get(HOME);
  if (known(saved)) return saved;
  const region = (typeof navigator !== "undefined" ? navigator.language : "").split("-").pop()?.toUpperCase() ?? "";
  const byRegion: Record<string, string> = { TW: "TWD", US: "USD", GB: "GBP", JP: "JPY", KR: "KRW", HK: "HKD", SG: "SGD", AU: "AUD", CA: "CAD", CN: "CNY" };
  return byRegion[region] ?? (lang === "zh" ? "TWD" : "USD");
}
export const setHomeCurrency = (c: string) => put(HOME, c);
/** 這個行程當地用的貨幣：使用者換過就記在這支手機上（一個行程一個）。 */
export const localCurrency = (tripId: string, dest: Country) => { const s = get(LOCAL + tripId); return known(s) ? s : destCurrency(dest); };
export const setLocalCurrency = (tripId: string, c: string) => put(LOCAL + tripId, c);

export function cachedRates(): Rates | null {
  try {
    const r = JSON.parse(get(CACHE) ?? "null") as Rates | null;
    return r && typeof r.date === "string" && typeof r.at === "number" && r.usd && typeof r.usd === "object" ? r : null;
  } catch { return null; }
}
const SOURCES = [
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
  "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
];
/** 抓最新的匯率表（以美元為基準）。三小時內抓過就用存著的；抓不到就回存著的那一份（可能是 null）。 */
export async function loadRates(): Promise<Rates | null> {
  const old = cachedRates();
  if (old && Date.now() - old.at < 3 * 3600_000) return old;
  for (const url of SOURCES) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json() as { date?: unknown; usd?: Record<string, unknown> };
      if (typeof j.date !== "string" || !j.usd || typeof j.usd !== "object") continue;
      const usd: Record<string, number> = {};
      for (const { code } of CURRENCIES) { const v = j.usd[code.toLowerCase()]; if (typeof v === "number" && v > 0 && Number.isFinite(v)) usd[code] = v; }
      if (Object.keys(usd).length < 2) continue;
      const fresh: Rates = { date: j.date.slice(0, 10), at: Date.now(), usd };
      put(CACHE, JSON.stringify(fresh));
      return fresh;
    } catch { /* try the next source */ }
  }
  return old;
}
/** 1 單位 from 等於多少 to；匯率表裡沒有就回 null。 */
export const rateOf = (r: Rates | null, from: string, to: string): number | null => (r && r.usd[from] && r.usd[to] ? r.usd[to] / r.usd[from] : null);
/** 沒有小數的貨幣（日圓、韓元、越南盾、新台幣習慣上也不寫小數）。 */
const WHOLE = new Set(["JPY", "KRW", "VND", "TWD"]);
export const fmtMoney = (n: number, code: string) => n.toLocaleString("en-US", { maximumFractionDigits: WHOLE.has(code) ? 0 : 2, minimumFractionDigits: 0 });
/** 匯率那一行用：數字很小的時候多留幾位（1 JPY = 0.0063 USD）。 */
export const fmtRate = (n: number) => (n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : n >= 1 ? n.toFixed(3) : n.toPrecision(3));
/** 常用金額的快捷鍵，照那個貨幣的面額大小。 */
export const quickAmounts = (code: string) => (code === "JPY" ? [1000, 3000, 5000, 10000] : code === "KRW" ? [10000, 30000, 50000, 100000] : code === "TWD" ? [100, 500, 1000, 3000] : code === "VND" ? [100000, 200000, 500000, 1000000] : code === "THB" || code === "HKD" || code === "CNY" ? [100, 200, 500, 1000] : [10, 20, 50, 100]);
