// 「其他資訊」的「✦ 幫我整理」：把使用者貼的一段文字整理成好讀的 Markdown 頁。
// 省錢的設計：用 Haiku、不掛上網工具、不帶整份行程、輸出上限固定；每個行程和每個人每天最多 N 次（ai_calls 表計數）。
//   一次大約就是貼進來的字數 + 整理後的字數，比聊天一次（帶整份行程、常常上網搜）便宜一個量級以上。
import { handle, json, HttpError, readJson } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { aiErrorMessage, anthropic, FORMAT_MODEL } from "../_shared/claude.ts";
import { reserve, settle, sumUsage } from "../_shared/usage.ts";

const MAX_CHARS = 8000;

const SYSTEM = `你是旅遊網站「其他資訊」頁的排版小幫手。使用者會貼一段文字（官網、新聞、LINE 訊息、自己的筆記），請把它整理成一頁好讀的 Markdown。
- 第一行是「# 標題」（10 個字內；使用者有給標題就沿用）。
- 只整理原文裡有的資訊：不要加入原文沒有的事實、不要猜、不要上網。原文有矛盾或看不懂的地方放在最後的「## 待確認」。
- 步驟用「1. 」編號清單；並列的東西用「- 」；要比較多個東西（價格、時間、品牌、方案）用表格；重要提醒用粗體。
- 原文的數字、時間、金額、地址、電話、網址一字不改地保留。
- 原文裡的圖片語法 ![說明](網址) 一字不改地保留，放在它原本描述的那一項旁邊（表格就放在同一列）。
- 刪掉廣告、重複、客套話。用台灣用語的繁體中文；原文是日文或英文就翻成中文，店名、商品名保留原文並附中文。
- 只輸出 Markdown，不要前言、不要說明你做了什麼。`;

Deno.serve(handle(async (req) => {
  const body = await readJson<{ trip_id?: string; text?: unknown; title?: unknown; lang?: unknown }>(req, 100_000);
  const english = body.lang === "en";
  const { admin, trip, uid } = await requireMember(req, body, { editor: true });
  const text = (typeof body.text === "string" ? body.text : "").trim();
  const title = (typeof body.title === "string" ? body.title : "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (text.length < 20) throw new HttpError(400, "先貼一段文字再按整理（至少 20 個字）");
  if (text.length > MAX_CHARS) throw new HttpError(400, `一次最多 ${MAX_CHARS} 個字，請分成幾段整理`);

  // 每人、每個行程的每日上限；先記一筆再呼叫模型
  const quota = await reserve(admin, "format-info", { tripId: trip.id, uid, tz: trip.tz });

  let res;
  try {
    res = await anthropic({ timeoutMs: 90_000, maxRetries: 1 }).messages.create({
      model: FORMAT_MODEL,
      // 整理後的長度和原文差不多，中文一個字大約一個 token 以上；原本 3000 會把 3000 字以上的中文截掉
      max_tokens: 10000,
      output_config: { effort: "low" },
      // 介面選英文的人：整理成英文（原文的店名、商品名、數字照樣保留）
      system: english ? SYSTEM + "\n- 這位使用者的介面是英文：整頁用自然的英文寫（上面「用繁體中文」「翻成中文」的規則改成用英文、翻成英文）；店名、商品名保留原文，後面可以用括號補英文。「待確認」那一節的標題寫成「## To confirm」。" : SYSTEM,
      messages: [{ role: "user", content: `${title ? `標題（使用者填的，請沿用）：${title}\n` : ""}原文：\n${text}` }],
    });
  } catch (e) {
    const msg = aiErrorMessage(e);
    await settle(admin, quota, { model: FORMAT_MODEL, chars: text.length, error: msg });
    throw new HttpError(502, `整理失敗：${msg}`);
  }
  const usage = { model: res.model, chars: text.length, ...sumUsage(FORMAT_MODEL, [res.usage]) };
  console.log("format-info usage", JSON.stringify(usage));
  await settle(admin, quota, usage);

  if (res.stop_reason === "refusal") throw new HttpError(400, "這段內容不方便整理");
  let md = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (res.stop_reason === "max_tokens") md += "\n\n（內容太長，後面被截掉了；請分段整理）";
  // first "# …" line → title, the rest is the page body
  const m = md.match(/^#\s+(.+)\n?/);
  const outTitle = (m?.[1] ?? title).trim().slice(0, 60);
  const outBody = (m ? md.slice(m[0].length) : md).trim();

  return json({ title: outTitle, body: outBody, remaining: quota.remaining });
}));
