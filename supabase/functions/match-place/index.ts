// 背景的地標配對：某一天的城市在元素庫裡對不到關鍵字時，請 AI 從「現成的元素」裡挑一個最貼切的，記進 backdrop_places。
// AI 只挑、不畫：元素都是事先畫好、看過的，所以不會出現歪掉的圖；同一個城市只會問一次（所有行程、所有人共用那個結果）。
// 省錢：Haiku、輸入只有城市名和元素清單（約一千多 token）、輸出一個 id；每人每天、每個行程每天有上限。
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.8.0/helpers/zod";
import { z } from "npm:zod@4";
import { handle, json, HttpError, readJson } from "../_shared/http.ts";
import { requireMember } from "../_shared/supa.ts";
import { aiErrorMessage, anthropic, FORMAT_MODEL } from "../_shared/claude.ts";
import { reserve, settle, sumUsage } from "../_shared/usage.ts";
import { matchByKeyword } from "../_shared/backdrops.ts";

const norm = (s: string) => s.trim().toLowerCase().slice(0, 60);

Deno.serve(handle(async (req) => {
  const body = await readJson<{ trip_id?: string; city?: unknown }>(req, 2000);
  const { admin, trip, uid } = await requireMember(req, body);
  const city = typeof body.city === "string" ? body.city.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const place = norm(city);
  if (!place) throw new HttpError(400, "沒有城市");
  // 只配對這個行程裡真的出現過的城市：不然任何成員都可以拿這個函式把配對表塞滿
  const { data: used } = await admin.from("days").select("city").eq("trip_id", trip.id);
  if (!(used ?? []).some((d) => norm(String(d.city ?? "")) === place)) throw new HttpError(400, "這個行程沒有這個城市");

  const { data: known } = await admin.from("backdrop_places").select("element_id").eq("place", place).maybeSingle();
  if (known) return json({ element_id: known.element_id ?? null, cached: true });

  const { data: elements, error } = await admin.from("backdrop_elements").select("id, name, hint, keywords");
  if (error) throw new HttpError(500, "讀不到背景元素");
  if (!elements?.length) return json({ element_id: null, cached: false });
  // 關鍵字對得上的不用問（前端本來就會對到；這裡再對一次，是給元素庫剛加了新元素、前端還拿著舊的那一份的情況）
  const byKeyword = matchByKeyword(place, elements as { id: string; keywords: string[] }[]);
  if (byKeyword) return json({ element_id: byKeyword, cached: false });

  const quota = await reserve(admin, "match-place", { tripId: trip.id, uid, tz: trip.tz });
  const ids = elements.map((e) => e.id as string);
  const Pick = z.object({ element_id: z.string().describe("清單裡的一個 id；沒有任何一個說得過去就填 none") });
  let picked: string | null = null;
  try {
    const res = await anthropic({ timeoutMs: 25_000, maxRetries: 1 }).messages.create({
      model: FORMAT_MODEL,
      // 答案只有一個 id，但留寬一點：元素變多之後，上限太小會在回答寫完之前就被截斷（變成解析不了的半截 JSON）
      max_tokens: 1500,
      system: "你幫旅遊行程網站挑背景圖。給你一個城市或地點的名稱，和一份已經畫好的背景元素清單（id：名稱。說明）。挑出最能代表那個地方的一個元素：先看是不是那個城市或國家的地標，沒有的話看地方的類型（海邊、山上、大城市、溫泉、寺廟、樂園、機場…）。只能從清單挑；真的沒有任何一個說得過去才回 none。",
      messages: [{ role: "user", content: `地點：${city}\n這趟行程：${trip.name}${trip.place ? `（${trip.place}）` : ""}\n\n元素清單：\n${elements.map((e) => `${e.id}：${e.name}。${e.hint}`).join("\n")}` }],
      output_config: { format: zodOutputFormat(Pick), effort: "low" },
    });
    const usage = { model: res.model, city, ...sumUsage(FORMAT_MODEL, [res.usage]) };
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const id = Pick.parse(JSON.parse(text)).element_id.trim();
    picked = ids.includes(id) ? id : null;
    console.log("match-place", JSON.stringify({ ...usage, picked }));
    await settle(admin, quota, { ...usage, picked });
  } catch (e) {
    const msg = aiErrorMessage(e);
    await settle(admin, quota, { model: FORMAT_MODEL, city, error: msg });
    throw new HttpError(502, `配對失敗：${msg}`);
  }
  // 記下來（包括「沒有適合的」），同一個城市不再問第二次；剛好有人同時問到就留先寫進去的那一筆
  await admin.from("backdrop_places").upsert({ place, element_id: picked, source: "ai", created_by: uid }, { onConflict: "place", ignoreDuplicates: true });
  const { data: final } = await admin.from("backdrop_places").select("element_id").eq("place", place).maybeSingle();
  return json({ element_id: final?.element_id ?? picked, cached: false });
}));
