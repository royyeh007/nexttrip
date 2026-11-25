-- 地點搜尋的次數也記在 ai_calls。建立新行程時要選主要城市，那時候還沒有行程，所以 trip_id 要可以是空的。
-- （空的那幾筆只用來數「這個人今天查了幾次」；每個行程的報表本來就用 trip_id 篩，看不到它們。）
alter table public.ai_calls alter column trip_id drop not null;
