// 語言：中文（原本的）和英文。畫面上的字在程式裡還是寫中文，外面包一層 t("中文")；
// 選英文時到 src/locales/en.ts 找對應的英文，找不到就照原樣顯示中文（所以漏翻的地方不會壞，只是還是中文）。
// 語言記在這支手機上（localStorage），預設跟著瀏覽器的語言。切換時整頁重新載入，所以每個元件不用自己監聽語言。
// 使用者自己輸入的內容（地點名稱、備註、家庭名稱）不翻譯。
import { createElement, Fragment } from "react";
import type { ReactNode } from "react";
import en from "./locales/en";

export type Lang = "zh" | "en";
const KEY = "jp-lang";
function initial(): Lang {
  if (typeof window === "undefined") return "zh"; // 測試和 seed 腳本（不是瀏覽器）一律中文
  try { const v = localStorage.getItem(KEY); if (v === "zh" || v === "en") return v; } catch { /* storage blocked */ }
  const nav = typeof navigator !== "undefined" ? (navigator.languages?.[0] ?? navigator.language ?? "") : "";
  return /^zh/i.test(nav) ? "zh" : "en";
}
export const lang: Lang = initial();
if (typeof document !== "undefined") document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
/** Remember the choice on this device and reload so every screen is drawn in the new language. */
export function setLang(next: Lang) {
  try { localStorage.setItem(KEY, next); } catch { /* storage blocked: nothing to remember */ }
  if (next !== lang) location.reload();
}

const fill = (s: string, vars?: Record<string, string | number | null | undefined>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m)) : s);
/**
 * Translate one string. The Chinese text is the key: `t("儲存")`, `t("共 {n} 人", { n })`.
 * Unknown strings (user content, a server message nobody translated) come back unchanged.
 */
export function t(zh: string, vars?: Record<string, string | number | null | undefined>): string {
  // 同一個中文在英文要分兩種說法時，鍵後面加 #標記（「加入#add」）；中文顯示時把標記拿掉。
  const plain = zh.replace(/#[a-z]+$/, "");
  return fill(lang === "en" ? (en[zh] ?? en[plain] ?? plain) : plain, vars);
}
/**
 * A sentence with elements inside it: `tr("到 <a>信用卡</a> 勾你有的卡", { a: (c) => <a href="#cards">{c}</a> })`.
 * The tags mark which words go inside which element, so the translation can put them in a different place in the sentence.
 * `{name}` placeholders work as in `t`.
 */
export function tr(zh: string, tags: Record<string, (children: string) => ReactNode>, vars?: Record<string, string | number | null | undefined>): ReactNode {
  const s = t(zh, vars);
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/gs;
  let last = 0, k = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    out.push(createElement(Fragment, { key: k++ }, tags[m[1]] ? tags[m[1]](m[2]) : m[2]));
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return createElement(Fragment, null, ...out);
}
/** The weekday stored on a day ("一" … "日") in the current language ("Mon" … "Sun"). */
const WEEK: Record<string, string> = { 一: "Mon", 二: "Tue", 三: "Wed", 四: "Thu", 五: "Fri", 六: "Sat", 日: "Sun" };
export const wk = (w: string) => (lang === "en" ? WEEK[w] ?? w : w);
/** Join a list the way the language does: 「A、B、C」 / "A, B, C". */
export const list = (items: string[]) => items.join(lang === "en" ? ", " : "、");
