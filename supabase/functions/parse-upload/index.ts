// 收一個上傳的檔案（xlsx / csv / 照片 / PDF / 純文字）或一段文字，用 Claude 讀成某個行程（trip_id）的行程提案，存進 uploads 等使用者確認。
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
// SheetJS 官方 0.20.3（npm 上的 xlsx@0.18.5 已經不更新、有已知漏洞，而這裡解析的是使用者上傳的檔案）。來源和雜湊見 _shared/vendor/README.md
import * as XLSX from "../_shared/vendor/xlsx-0.20.3.mjs";
import type Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.8.0/helpers/zod";
import { handle, json, HttpError, readJson } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { aiErrorMessage, anthropic, MODEL } from "../_shared/claude.ts";
import { ProposalZ, formatGuide, normalize } from "../_shared/proposal.ts";
import type { GuideCtx } from "../_shared/proposal.ts";
import { reserve, settle, sumUsage } from "../_shared/usage.ts";

type Block = Anthropic.ContentBlockParam;

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 照片、PDF 會整個 base64 送給模型：8 MB 已經很大
const MAX_TEXT_CHARS = 30_000;          // 貼的文字、表單轉成的 CSV
// 網頁產生的檔名：<時間戳>-<檔名（只留英數底線連字號，最多 40 字）>.<副檔名>
const FILE_RE = /^\d{10,16}-[A-Za-z0-9_-]{0,40}\.(xlsx|xls|csv|png|jpe?g|webp|gif|pdf|txt|md)$/i;

function xlsxToText(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name: string) => `## 工作表「${name}」\n${XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false })}`).join("\n\n");
}

const system = (ctx: GuideCtx) => `你在幫一群家庭整理「${ctx.trip.name}」的行程${ctx.trip.place ? `（${ctx.trip.place}）` : ""}，日期 ${ctx.trip.start_date} 到 ${ctx.trip.end_date}。
使用者會給你一份填好的行程表單（Excel 轉成的 CSV）、一張行程截圖、PDF，或一段文字。
把裡面的行程讀出來，整理成指定的 JSON 格式。表單裡的日期只有月／日，年份照這個行程的日期判斷。

${formatGuide(ctx)}

表單的「基本資料」工作表有家庭、航班、每天晚上住哪、哪幾天是跟別家一起走的（寫進 joins）。
「行程1」到「行程5」工作表每頁一天：最上面「這一頁是哪一天」那格是日期（例 12/24），沒填日期或整頁空白的工作表跳過。每頁一行一個地點，第一行灰色的是範例，忽略範例、空白列和「範例」那張工作表。
每一天的 hotel 從「基本資料」的住宿那一行對應日期找。
「怎麼去」那欄是從上一站過去的交通，要變成前一個 leg。
只整理資料裡真的有的東西，不要自己補行程；不確定的寫進 notes。`;

Deno.serve(handle(async (req) => {
  const body = await readJson<{ path?: unknown; text?: unknown; family_id?: string; trip_id?: string }>(req);
  const { user, admin, member, trip, uid, who } = await requireMember(req, body, { editor: true });
  const { data: famRows } = await admin.from("families").select("id, label").eq("trip_id", trip.id).order("sort");
  const families = (famRows ?? []) as { id: string; label: string }[];
  const family_id = member.role === "admin" && body.family_id && families.some((f) => f.id === body.family_id) ? body.family_id : member.family_id;
  const pasted = typeof body.text === "string" ? body.text.trim() : "";
  if (pasted.length > MAX_TEXT_CHARS) throw new HttpError(400, `一次最多貼 ${MAX_TEXT_CHARS.toLocaleString()} 個字，請分成幾次（例如一次兩三天）`);

  const content: Block[] = [];
  let kind = "text";
  let path: string | null = null;
  if (body.path != null && body.path !== "") {
    // 整條路徑都要對：<這個行程>/<這個行程裡的一家>/<網頁產生的檔名>。只檢查開頭的話，"../" 可以把請求帶到別的地方去。
    if (typeof body.path !== "string") throw new HttpError(400, "檔案路徑不對");
    const seg = body.path.split("/");
    if (seg.length !== 3 || seg[0] !== trip.id || !families.some((f) => f.id === seg[1]) || !FILE_RE.test(seg[2])) throw new HttpError(400, "檔案路徑不對");
    if (member.role !== "admin" && seg[1] !== member.family_id) throw new HttpError(403, "不能讀別家的檔案");
    path = body.path;
    // 用呼叫者自己的身分下載（storage 的規則會再擋一次），不用 service role
    const { data: blob, error } = await user.storage.from("uploads").download(path);
    if (error || !blob) throw new HttpError(400, "讀不到檔案，請重新上傳一次");
    if (blob.size > MAX_FILE_BYTES) throw new HttpError(400, "檔案太大（上限 8 MB）。照片請截圖或縮小，PDF 請只留行程那幾頁");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ext = seg[2].split(".").pop()!.toLowerCase();
    if (["xlsx", "xls", "csv"].includes(ext)) {
      const sheet = xlsxToText(bytes);
      if (sheet.length > MAX_TEXT_CHARS * 2) throw new HttpError(400, "表單內容太多，請分成幾個檔（例如一個檔放三天）");
      kind = "file"; content.push({ type: "text", text: sheet });
    }
    else if (ext in IMAGE_TYPES) { kind = "image"; content.push({ type: "image", source: { type: "base64", media_type: IMAGE_TYPES[ext], data: encodeBase64(bytes) } }); }
    else if (ext === "pdf") { kind = "pdf"; content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: encodeBase64(bytes) } }); }
    else {
      const txt = new TextDecoder().decode(bytes);
      if (txt.length > MAX_TEXT_CHARS) throw new HttpError(400, `文字檔太長（上限 ${MAX_TEXT_CHARS.toLocaleString()} 個字），請分成幾個檔`);
      kind = "file"; content.push({ type: "text", text: txt });
    }
  }
  if (pasted) content.push({ type: "text", text: pasted });
  if (content.length === 0) throw new HttpError(400, "沒有內容");
  content.push({ type: "text", text: `上傳的人是 ${who}，屬於家庭 id「${family_id}」。表單裡沒寫家庭就用這個。` });

  // 每人、每個行程的每日上限；先記一筆再呼叫模型
  const quota = await reserve(admin, "parse-upload", { tripId: trip.id, uid, tz: trip.tz });

  const { data: row, error: insErr } = await admin.from("uploads")
    .insert({ trip_id: trip.id, family_id, uploaded_by: uid, kind, path, text: pasted || null })
    .select("id").single();
  if (insErr || !row) { console.error("uploads insert failed:", insErr?.message); await settle(admin, quota, { error: "uploads insert" }); throw new HttpError(500, "存不進資料庫，稍後再試"); }

  let usage: Record<string, unknown> = { model: MODEL, kind };
  try {
    const { data: sharedRows } = await admin.from("days").select("date_id").eq("trip_id", trip.id).is("fam", null);
    const ctx: GuideCtx = { trip, families, sharedDates: [...new Set((sharedRows ?? []).map((d) => d.date_id as string))].sort() };
    // 串流版：SDK 對非串流的大 max_tokens 會拒絕。整個函式最多 150 秒，所以這一次呼叫最多等 135 秒、不重試，
    // 逾時才來得及把這筆上傳標成失敗（不然會被平台砍掉、永遠停在「處理中」）。
    const res = await anthropic({ timeoutMs: 135_000, maxRetries: 0 }).messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: system(ctx),
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(ProposalZ), effort: "medium" },
    }).finalMessage();
    usage = { ...usage, ...sumUsage(MODEL, [res.usage]) };
    if (res.stop_reason === "refusal") throw new Error("Trip醬拒絕處理這個內容");
    if (res.stop_reason === "max_tokens") throw new Error("輸出不完整，請把檔案拆小一點（例如一次一天）再試");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const proposal = normalize(ProposalZ.parse(JSON.parse(text)));
    // 家庭 id 一定要是這個行程裡的；非管理員只能送自己家的
    const famOk = families.some((f) => f.id === proposal.family_id);
    const finalFam = member.role === "admin" && famOk ? proposal.family_id : family_id;
    const fixed = { ...proposal, family_id: finalFam, joins: proposal.joins.filter((j) => families.some((f) => f.id === j.with)) };
    await admin.from("uploads").update({ parsed: fixed, family_id: finalFam }).eq("id", row.id);
    console.log("parse-upload usage", JSON.stringify(usage));
    await settle(admin, quota, usage);
    return json({ id: row.id, proposal: fixed });
  } catch (e) {
    const msg = aiErrorMessage(e);
    await admin.from("uploads").update({ status: "failed", error: msg }).eq("id", row.id);
    await settle(admin, quota, { ...usage, error: msg });
    throw new HttpError(500, `Trip醬解析失敗：${msg}`);
  }
}));
