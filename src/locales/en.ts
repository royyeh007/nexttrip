// 英文對照表：鍵是程式裡 t("…") / tr("…") 的中文原文，值是英文。找不到的鍵畫面上會照原樣顯示中文。
// 這個檔是合併出來的（seed/.build/i18n-merge.mjs）；要改某一句的英文，直接改這裡那一行就可以。
const en: Record<string, string> = {
  "不用 Google 搜尋，自己填": "Don’t search Google, I’ll fill it in",
  "不選清單上的地點，照我打的字": "Keep what I typed, don’t pick from the list",
  "改回用 Google 找地點": "Search Google for places again",
  "直接用「{text}」": "Just use “{text}”",
  "現在不搜尋，照你打的字。": "Search is off: the name stays as you type it.",
};
export default en;
