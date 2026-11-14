// 「信用卡」頁的「✦ 幫我查這張卡」：給一個卡名，Sonnet 上網查這張卡目前的海外交易手續費和各類消費的回饋，
// 整理成卡片庫的格式回傳；網頁把它填進表單，使用者看過再儲存（不直接寫資料庫）。
// 省錢：一張卡最多 4 次搜尋、固定輸出格式、每個行程和每個人每天最多 N 次（ai_calls 表計數，kind = card-lookup）。
import { betaZodTool } from "npm:@anthropic-ai/sdk@1.8.0/helpers/beta/zod";
import { z } from "npm:zod@4";
import { handle, json, HttpError, readJson } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { aiErrorMessage, anthropic, CHAT_MODEL } from "../_shared/claude.ts";
import { reserve, settle, sumUsage } from "../_shared/usage.ts";
import { COUNTRY_NAME, countryOf } from "../_shared/cards.ts";
import type { Country } from "../_shared/cards.ts";


const CardZ = z.object({
  name: z.string().max(80).describe("卡的正式名稱（英文卡保留英文）"),
  short: z.string().max(10).describe("標籤用短名，≤10 字，例：CSP、Venture X、CUBE"),
  bank: z.string().max(60).describe("發卡銀行"),
  country: z.enum(["us", "uk", "tw", "jp", "kr", "other"]).describe("發卡國"),
  network: z.array(z.enum(["visa", "mastercard", "amex", "jcb", "discover", "unionpay"])),
  fx_fee: z.number().min(0).max(10).describe("海外交易手續費 %（foreign transaction fee / non-sterling fee）；沒有就 0"),
  rates: z.array(z.object({
    where: z.enum(["overseas", "home", "jp", "kr"]).describe("overseas＝出國消費；home＝發卡國國內；jp／kr＝只有那一國才有的加碼"),
    kind: z.enum(["all", "food", "hotel", "shop", "sight", "move"]).describe("all＝其他一般消費；food 餐廳；hotel 住宿；shop 購物；sight 景點門票；move 交通（火車、計程車、交通卡加值）"),
    rate: z.number().min(0).max(50).describe("那個情況可以拿到的「總」回饋 %（已含基本回饋）。點數卡換成 %：Chase UR 1.25¢（CSP）／1.5¢（CSR）、Amex MR 1.5¢、Capital One 1.5¢、Citi TY 1.5¢、Bilt 1.5¢、航空哩程 1.3¢、Hyatt 1.7¢、Marriott 0.8¢、Hilton 0.5¢；英國 Avios 1p、英國 MR 0.5p、Virgin 1p"),
    note: z.string().optional().describe("一句話：怎麼算的，例「3x UR，以 1.25¢/點計」或「切成趣旅行方案」"),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("優惠到期日 YYYY-MM-DD；長期有效就不填"),
    cond: z.string().optional().describe("條件：要登錄、要切方案、上限、只限實體店…"),
  })).min(1),
  cap: z.string().max(300).describe("回饋上限一句話；沒有寫「無上限」"),
  conditions: z.string().max(600).describe("最重要的條件或限制一句話（年費、哪些加碼只限國內、Amex 接受度…）"),
  source: z.string().max(500).describe("最主要的來源網址，要是 https:// 開頭的完整網址（優先銀行官網）"),
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().describe("給使用者看的一句話：哪裡不確定、最近有沒有改版"),
});
type CardOut = z.infer<typeof CardZ>;

Deno.serve(handle(async (req) => {
  const body = await readJson<{ trip_id?: string; name?: unknown; country?: string }>(req, 20_000);
  const { admin, trip, uid } = await requireMember(req, body, { editor: true });
  // 卡名會進提示詞：去掉換行和控制字元
  // eslint-disable-next-line no-control-regex
  const name = (typeof body.name === "string" ? body.name : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) throw new HttpError(400, "先填卡片名稱");
  const hint = (["us", "uk", "tw", "jp", "kr", "other"] as Country[]).includes(body.country as Country) ? (body.country as Country) : null;

  // 每人、每個行程的每日上限；先記一筆再呼叫模型（失敗的也算，平行送也擋得住）
  const quota = await reserve(admin, "card-lookup", { tripId: trip.id, uid, tz: trip.tz });

  const dest = countryOf(trip.place);
  const today = new Date().toISOString().slice(0, 10);
  let saved: CardOut | null = null;
  const save = betaZodTool({
    name: "save_card",
    description: "查完之後用這個工具交出整理好的卡片資料（只呼叫一次）。",
    inputSchema: CardZ,
    run: async (input) => { saved = input; return "ok"; },
  });
  const webSearch = { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 4 };
  const system = `你是信用卡資料整理員。今天是 ${today}。使用者會給一張信用卡的名字${hint ? `（發卡國可能是${COUNTRY_NAME[hint]}）` : ""}，請上網查它「現在」的條款，整理成卡片庫格式，用 save_card 交出。
查的重點（這張卡會用在${COUNTRY_NAME[dest]}旅行）：
1. 海外交易手續費 %（美國卡常見 0 或 3；英國卡 0 或 2.99；台灣卡 1.5）。
2. 出國消費各類別的總回饋 %：一般、餐廳、住宿、購物、交通。點數卡用上面 schema 寫的換算值換成 %，note 裡寫怎麼算。
3. 哪些加碼只限發卡國國內（例如美國卡的超市、加油加碼；台灣卡的國內通路）就不要算進出國的回饋，放在 conditions 提一句。
4. 要登錄、要切方案、有上限、有到期日的，寫進 cond／until／cap。
5. 優先用銀行官網，再用可靠的信用卡網站（The Points Guy、NerdWallet、MoneySavingExpert、Head for Points、卡優、懶人卡）核對。最多搜尋 4 次。
不要編數字：查不到的欄位就不填（rates 至少要有一筆一般消費），並在 note 說明哪裡不確定。文字用台灣用語的繁體中文，卡名、點數計畫名保留原文。查完直接呼叫 save_card，不用再多說話。`;

  const calls: Record<string, unknown>[] = [];
  const started = Date.now();
  let failure: string | null = null;
  try {
    // 整個函式最多 150 秒：每次呼叫最多等 60 秒、不重試，跑超過 110 秒就停
    for await (const m of anthropic({ timeoutMs: 60_000, maxRetries: 0 }).beta.messages.toolRunner({
      model: CHAT_MODEL,
      max_tokens: 4000,
      max_iterations: 6,
      output_config: { effort: "medium" },
      system,
      tools: [webSearch, save],
      messages: [{ role: "user", content: `信用卡：${name}` }],
    })) {
      calls.push(m.usage as unknown as Record<string, unknown>);
      // runner 是先把這則訊息交出來、之後才執行工具：在這裡直接讀 save_card 的內容就可以收工，
      // 不用再多打一次 API 把「ok」送回去（那一次會把所有搜尋結果重讀一遍）。
      const call = m.content.find((b) => b.type === "tool_use" && b.name === "save_card");
      if (call && call.type === "tool_use") {
        const parsed = CardZ.safeParse(call.input);
        if (parsed.success) { saved = parsed.data; break; }
      }
      if (saved || Date.now() - started > 110_000) break;
    }
  } catch (e) {
    failure = aiErrorMessage(e);
  }
  const usage = { model: CHAT_MODEL, name, ...sumUsage(CHAT_MODEL, calls), ...(failure ? { error: failure } : {}) };
  console.log("card-lookup usage", JSON.stringify(usage));
  await settle(admin, quota, usage);

  if (failure) throw new HttpError(502, `查卡失敗：${failure}`);
  if (!saved) throw new HttpError(502, "查不到這張卡的資料，請自己填（或換個更完整的卡名再試）");
  const card = saved as CardOut;
  // 來源會變成頁面上的連結：只收 http(s) 網址
  const source = /^https?:\/\/\S+$/i.test(card.source.trim()) ? card.source.trim() : "";
  return json({ card: { ...card, source, checked_at: today }, remaining: quota.remaining });
}));
