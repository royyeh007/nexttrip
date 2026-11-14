// 跑 tests/*.test.ts：先用 esbuild（Vite 本來就帶著）把每個測試檔打包成純 JS，再交給 Node 內建的 test runner。
// 不連網路、不碰資料庫；只測純邏輯。 用法：npm test
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 打包後的檔案放在系統暫存資料夾：Node 的 test runner 不會去找 node_modules 底下的檔案（Node 22 會說 "Could not find"）。
// 測試裡讀的檔案（seed/cards.json、public/coupons/…）是相對於目前的資料夾，所以要從 repo 根目錄跑。
const out = mkdtempSync(join(tmpdir(), "trip-tests-"));
let status = 1;
try {
  const files = readdirSync("tests").filter((f) => f.endsWith(".test.ts"));
  execFileSync("node_modules/.bin/esbuild", [
    ...files.map((f) => join("tests", f)),
    "--bundle", "--platform=node", "--format=esm", `--outdir=${out}`, "--out-extension:.js=.mjs", "--log-level=warning",
    // the web app reads its Supabase settings from import.meta.env at import time: give the tests an empty one
    "--define:import.meta.env={}",
  ], { stdio: "inherit" });
  const r = spawnSync(process.execPath, ["--test", ...files.map((f) => join(out, f.replace(/\.ts$/, ".mjs")))], { stdio: "inherit" });
  status = r.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(status);
