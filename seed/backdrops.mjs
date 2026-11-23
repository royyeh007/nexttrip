// 把背景的元素庫（supabase/functions/_shared/backdrops.ts）寫進資料庫的 backdrop_elements。
// 要加新元素或改圖：改那個檔，再跑一次這支；網站不用重新部署，大家下次打開就會拿到。只新增和更新，不會刪掉資料庫裡多出來的。
//   node seed/backdrops.mjs          （預覽會寫入什麼）
//   node seed/backdrops.mjs --write
import { createClient } from "@supabase/supabase-js";
import { build } from "esbuild";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const dir = mkdtempSync(join(tmpdir(), "backdrops-"));
try {
  await build({ entryPoints: ["supabase/functions/_shared/backdrops.ts"], bundle: true, format: "esm", platform: "node", outfile: join(dir, "b.mjs"), logLevel: "warning" });
  const { BACKDROP_ELEMENTS } = await import(pathToFileURL(join(dir, "b.mjs")).href);
  const ids = new Set();
  for (const e of BACKDROP_ELEMENTS) { if (ids.has(e.id)) throw new Error(`id 重複：${e.id}`); ids.add(e.id); }
  const { data: have, error } = await svc.from("backdrop_elements").select("id, name, hint, keywords, shapes");
  if (error) throw error;
  const same = (a, b) => JSON.stringify([a.name, a.hint, a.keywords, a.shapes]) === JSON.stringify([b.name, b.hint, b.keywords, b.shapes]);
  const changed = BACKDROP_ELEMENTS.filter((e) => { const h = have.find((x) => x.id === e.id); return !h || !same(h, e); });
  const extra = have.filter((h) => !ids.has(h.id)).map((h) => h.id);
  console.log(`檔案裡 ${BACKDROP_ELEMENTS.length} 個，資料庫 ${have.length} 個；要新增或更新 ${changed.length} 個：${changed.map((e) => e.id).join("、") || "（沒有）"}${extra.length ? `\n只在資料庫裡的（不動）：${extra.join("、")}` : ""}`);
  if (!process.argv.includes("--write")) { console.log("（只是預覽，加 --write 才會寫入）"); }
  else if (changed.length) {
    const { error: e2 } = await svc.from("backdrop_elements").upsert(changed.map((e) => ({ id: e.id, name: e.name, hint: e.hint, keywords: e.keywords, shapes: e.shapes, updated_at: new Date().toISOString() })));
    if (e2) throw e2;
    console.log("已寫入");
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
