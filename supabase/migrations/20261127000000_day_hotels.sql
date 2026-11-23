-- 幾家共用同一份行程的那一天（大家一起的版本、兩三家合用的版本），每一家可以各住各的：
-- hotels = { 家庭 id: 飯店 }，有填就蓋過原本那個共用的 hotel 欄位；沒填的家照舊看 hotel。
alter table public.days add column if not exists hotels jsonb not null default '{}'::jsonb;
alter table public.days drop constraint if exists days_hotels_object;
alter table public.days add constraint days_hotels_object check (jsonb_typeof(hotels) = 'object' and length(hotels::text) < 4000);
