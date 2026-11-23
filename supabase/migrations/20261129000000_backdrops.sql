-- 背景的元素庫（所有行程共用）和「這個城市用哪一個元素」的配對。
--
-- backdrop_elements：一個元素＝一份形狀清單（矩形、圓、路徑…，顏色只有代號），不是 SVG 原始碼。
--   前端照清單畫，而且只認得那幾種形狀和顏色，所以這裡就算被寫進奇怪的東西，也只會畫出難看的圖，不會變成可以執行的內容。
--   來源是 supabase/functions/_shared/backdrops.ts，用 `node seed/backdrops.mjs` 寫進來（要加新元素：加在那個檔再跑一次，不用重新部署網站）。
-- backdrop_places：城市（行程某一天的「城市」欄位，轉小寫）→ 元素。元素自己的關鍵字對不上的城市，
--   由 match-place 函式請 AI 從現成的元素挑一個，記在這裡；之後所有人去那個城市都直接用，不會再問。element_id 是 null = 問過了，沒有適合的。
--
-- 兩張表登入的人都能讀；寫入只有 service role（種子腳本和 Edge Function），所以沒有給任何寫入的 policy。

create table public.backdrop_elements (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 40),
  hint text not null default '' check (char_length(hint) <= 300),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 60),
  shapes jsonb not null check (jsonb_typeof(shapes) = 'array' and length(shapes::text) < 20000),
  updated_at timestamptz not null default now()
);
alter table public.backdrop_elements enable row level security;
create policy "signed-in read backdrop elements" on public.backdrop_elements for select to authenticated using (true);

create table public.backdrop_places (
  place text primary key check (char_length(place) between 1 and 60),
  element_id text references public.backdrop_elements (id) on delete cascade,
  source text not null default 'ai' check (source in ('ai', 'manual')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.backdrop_places enable row level security;
create policy "signed-in read backdrop places" on public.backdrop_places for select to authenticated using (true);

revoke all on public.backdrop_elements, public.backdrop_places from anon, authenticated;
grant select on public.backdrop_elements, public.backdrop_places to authenticated;
