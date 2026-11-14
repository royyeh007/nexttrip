import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { HttpError } from "./http.ts";

// 上傳整理（結構化輸出，品質優先）
export const MODEL = "claude-opus-5-5";
// 聊天（量大，成本優先）
export const CHAT_MODEL = "claude-sonnet-5-5";
// 排版小工具（「幫我整理」：不用推理、不上網，最便宜的就夠）
export const FORMAT_MODEL = "claude-haiku-5-5";

/**
 * Edge Function 整個請求最多跑 150 秒（免費方案），SDK 預設卻是等 10 分鐘、再重試 2 次：
 * 那樣函式會被平台直接砍掉，catch 來不及跑，資料庫裡的「處理中」就永遠留著。
 * 所以每次呼叫最多等 100 秒、只重試一次（429／5xx 這種馬上回來的錯誤才值得重試）。
 */
export function anthropic(opts: { timeoutMs?: number; maxRetries?: number } = {}) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new HttpError(500, "伺服器還沒設定 ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 100_000, maxRetries: opts.maxRetries ?? 1 });
}

/** 給使用者看的錯誤訊息：Anthropic 回的原始內容（額度、金鑰、內部細節）只進 log，不回給網頁。 */
export function aiErrorMessage(e: unknown): string {
  console.error("AI call failed:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  if (e instanceof Anthropic.RateLimitError) return "AI 服務現在太忙，等一分鐘再試";
  if (e instanceof Anthropic.AuthenticationError) return "AI 服務的金鑰有問題，請通知這個網站的管理員";
  if (e instanceof Anthropic.APIConnectionError) return "AI 服務太久沒有回應，稍後再試；內容很多的話拆小一點";
  if (e instanceof Anthropic.APIError) return (e.status ?? 500) >= 500 ? "AI 服務暫時有問題，稍後再試" : "AI 服務不接受這個請求，換個說法或把內容拆小再試";
  if (e instanceof HttpError) return e.message;
  if (e instanceof Error && e.name === "ZodError") return "AI 回的格式不對，請再試一次";
  if (e instanceof SyntaxError) return "AI 回的內容不完整，請再試一次";
  // 我們自己丟的 Error（例如「輸出不完整，請把檔案拆小一點」）訊息本來就是寫給使用者看的
  return e instanceof Error ? e.message : "出錯了，稍後再試";
}
