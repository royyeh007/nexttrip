# vendor

第三方程式庫的原始檔，照原樣放著，不要手改。

| 檔案 | 來源 | 授權 | sha256 |
|---|---|---|---|
| `xlsx-0.20.3.mjs` | https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs （SheetJS 官方發佈點，2026-11-15 下載） | Apache-2.0 | `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db` |

為什麼放在這裡：npm 上的 `xlsx` 停在 0.18.5（有 CVE-2023-30533、CVE-2024-22363），SheetJS 之後的版本只在自己的 CDN 發佈，
而 Supabase 的 Edge Function 打包器不允許從那個網域匯入。`parse-upload` 用它把使用者上傳的 Excel 轉成文字。

更新版本：到 https://cdn.sheetjs.com/ 看最新版號，下載 `package/xlsx.mjs` 換掉這個檔，更新上面的表和 `parse-upload/index.ts` 的匯入路徑。
