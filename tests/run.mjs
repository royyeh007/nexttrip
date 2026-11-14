// 跑 tests/*.test.ts：先用 esbuild（Vite 本來就帶著）把每個測試檔打包成純 JS，再交給 Node 內建的 test runner。
// 不連網路、不碰資料庫；只測純邏輯。 用法：npm test
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const out = "node_modules/.tmp/tests";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = readdirSync("tests").filter((f) => f.endsWith(".test.ts"));
execFileSync("node_modules/.bin/esbuild", [
  ...files.map((f) => join("tests", f)),
  "--bundle", "--platform=node", "--format=esm", `--outdir=${out}`, "--out-extension:.js=.mjs", "--log-level=warning",
  // the web app reads its Supabase settings from import.meta.env at import time: give the tests an empty one
  "--define:import.meta.env={}",
], { stdio: "inherit" });
const r = spawnSync(process.execPath, ["--test", ...files.map((f) => join(out, f.replace(/\.ts$/, ".mjs")))], { stdio: "inherit" });
process.exit(r.status ?? 1);
