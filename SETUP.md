# 第一次設定（Supabase + Google 登入 + Claude）

網頁放在 GitHub Pages（公開的空殼），行程、成員、上傳都在 Supabase，登入並加入某一家才看得到（加入後四家的行程互相都看得到）。
Claude 的 API key 只放在 Supabase 的 Edge Function 裡，不會出現在 repo 或網頁。

## 1. Supabase 專案

1. https://supabase.com → New project（免費方案就夠）。
2. **Settings → API** 記下：Project URL、`anon` key、`service_role` key。
3. **Settings → General** 記下 Project ref（網址裡 `https://<ref>.supabase.co` 的那段）。

## 2. Google 登入

1. https://console.cloud.google.com → 建一個專案 → **APIs & Services → OAuth consent screen**：
   User type 選 External，填 App 名稱（例如「日本跨年行程」）和你的 email。
   做完按 **Publish app**（只用基本資料，不需要 Google 審核）。不 Publish 的話只有列在 Test users 的 email 能登入。
2. **Credentials → Create credentials → OAuth client ID** → Web application。
   Authorized redirect URIs 加：`https://<ref>.supabase.co/auth/v1/callback`。
   記下 Client ID 和 Client secret。
3. 把 Client ID / Secret 填進 `.env.local` 的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`，跑 `make auth-push`。
   它會先列出要改的設定再問你，看過再按確定。（或在 Supabase 後台 **Authentication → Providers → Google** 手動貼。）
4. Site URL 和 Redirect URLs 已經在 `supabase/config.toml` 裡，`make auth-push` 會一起推上去。
5. **把 Email 登入關掉**：Supabase 後台 **Authentication → Sign In / Providers → Email** 整個關閉（這個網站只用 Google）。
   開著的話，任何人都能用隨便一個 email 註冊拿到登入身分。`supabase/config.toml` 裡也已經設成關閉。

## 3. 本機設定檔

```bash
cp .env.example .env.local
```
填 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SITE_URL`（`seed/trip.ts` 沒有寫行程 id 的話再加 `TRIP_ID`）。
`.env.local` 不會進 git。

## 4. 建表、部署、灌資料

Claude API key 在 https://console.anthropic.com → API keys 產生。

```bash
supabase login                              # 開瀏覽器登入 Supabase
make link REF=<project ref>
make db-push                                # 建表、權限、Storage bucket
make secrets                                # 給 Edge Function 用的 Claude key（會問你，輸入時不顯示）
make fn-deploy                              # 部署七個 function
make seed                                   # 把 seed/trip.ts 的行程、表單放進去（只補缺的），最後會印出邀請連結
```

另外兩個 secret（航班即時狀態要用，沒設的話那個功能自己關掉）：

```bash
supabase secrets set AVIATIONSTACK_KEY=...   # https://aviationstack.com 免費方案
supabase secrets set CRON_TOKEN=...          # 自己產生一串長亂碼；同一串放進 GitHub repo 的 secret FLIGHT_CRON_TOKEN
```

建議到 https://console.anthropic.com → Settings → Limits 設每月支出上限。網站自己有每人、每個行程的每日次數上限，這是最後一道保險。

## 5. GitHub Pages

repo → **Settings → Secrets and variables → Actions → Variables** 加兩個（這兩個本來就是公開的，不是機密）：
`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。或用指令：

```bash
gh variable set VITE_SUPABASE_URL --body "https://<ref>.supabase.co"
gh variable set VITE_SUPABASE_ANON_KEY --body "eyJ..."
```

Pages 的來源已經設成 GitHub Actions；之後每次 push 到 `main` 都會自動部署。
`.github/workflows/keepalive.yml` 每天打一次 Supabase，免得免費方案 7 天沒人用被暫停。

## 6. 平常怎麼用

- **邀請家人**：登入後到「管理行程 → 邀請連結」產生一個（可以選幾天後失效、能用幾次、先指定是哪一家），複製傳給家人。他們點開 → 邀請碼已帶入 → 用 Google 登入 → 選自己是哪一家，就加入了。管理員邀請預設只能用 1 次。
- **改行程**：
  - 平常都在網站上改。`make seed` 只會補上資料庫裡還沒有的日子，不會動已經有的。
  - 真的要整份用 `seed/trip.ts` 蓋回去：`make seed-overwrite`。大家在網站上加的地點、備註、勾過的待辦、填的航班都會被檔案的內容取代，執行前會要你輸入行程名稱確認。
  - 家人上傳表單／截圖，或在「問 Claude」直接說要改什麼 → 自己按「確認，更新行程」就生效（不用你審核）。
- **本機預覽**：`make`，開 http://localhost:5173。登入後資料一樣從 Supabase 來。
