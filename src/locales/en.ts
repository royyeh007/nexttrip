// 英文對照表：鍵是程式裡 t("…") / tr("…") 的中文原文，值是英文。找不到的鍵畫面上會照原樣顯示中文。
// 這個檔是合併出來的（seed/.build/i18n-merge.mjs）；要改某一句的英文，直接改這裡那一行就可以。
const en: Record<string, string> = {
  "至少要有一個人去": "At least one person has to go",
};
export default en;
