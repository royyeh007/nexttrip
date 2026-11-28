-- 口袋名單：每個人自己收藏的地點（跟著帳號，不屬於任何行程）
--
-- pocket_places：收藏的地點。分類是自己取的名字（例：想吃的甜點）；照片最多三張，存在 pocket-photos bucket 的 <user_id>/ 底下。
-- pocket_uses  ：這個地點曾經排進哪些行程的哪一天（從行程存進來、或從口袋名單加到行程時記一筆）。行程刪掉後名字還留著。
-- pocket_shares：分享連結。一個連結指到幾個地點（建立時選的那幾個）；拿到連結、有登入的人可以看，並複製到自己的口袋名單。
--
-- 前兩張表只有本人讀寫（RLS 照 user_id）。分享那張不給 policy，全部經過下面的函式。

create table public.pocket_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'sight' check (kind in ('food', 'sight', 'hotel', 'shop', 'move')),
  category text not null default '' check (char_length(category) <= 30),
  city text not null default '' check (char_length(city) <= 60),
  q text not null default '' check (char_length(q) <= 300),
  addr text not null default '' check (char_length(addr) <= 300),
  tel text not null default '' check (char_length(tel) <= 60),
  s text not null default '' check (char_length(s) <= 300),
  note text not null default '' check (char_length(note) <= 2000),
  -- 從行程帶過來的其他內容：{ info: [], rec: [], tips: [], ll: [lat, lon] }
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8000),
  photos text[] not null default '{}' check (cardinality(photos) <= 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pocket_places_user_idx on public.pocket_places (user_id);

-- 照片只能是自己資料夾裡的檔案
create or replace function public.pocket_photos_ok(u uuid, ph text[]) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(bool_and(p ~ ('^' || u::text || '/[A-Za-z0-9_-]{8,60}\.(jpg|png|webp)$')), true) from unnest(ph) p
$$;
alter table public.pocket_places add constraint pocket_places_photos_own check (public.pocket_photos_ok(user_id, photos));

create or replace function public.pocket_places_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.pocket_places where user_id = new.user_id) >= 500 then raise exception '口袋名單最多 500 個地點'; end if;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end
$$;
create trigger pocket_places_guard before insert or update on public.pocket_places for each row execute function public.pocket_places_guard();

alter table public.pocket_places enable row level security;
create policy "own pocket places: read" on public.pocket_places for select to authenticated using (user_id = auth.uid());
create policy "own pocket places: add" on public.pocket_places for insert to authenticated with check (user_id = auth.uid());
create policy "own pocket places: change" on public.pocket_places for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own pocket places: remove" on public.pocket_places for delete to authenticated using (user_id = auth.uid());
revoke all on public.pocket_places from anon, authenticated;
grant select, insert, update, delete on public.pocket_places to authenticated;

create table public.pocket_uses (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.pocket_places (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  trip_name text not null check (char_length(trip_name) between 1 and 120),
  date_id text not null default '' check (date_id = '' or date_id ~ '^\d{4}-\d{2}-\d{2}$'),
  created_at timestamptz not null default now(),
  unique (place_id, trip_id, date_id)
);
create index pocket_uses_user_idx on public.pocket_uses (user_id);
alter table public.pocket_uses enable row level security;
create policy "own pocket uses: read" on public.pocket_uses for select to authenticated using (user_id = auth.uid());
create policy "own pocket uses: add" on public.pocket_uses for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.pocket_places p where p.id = place_id and p.user_id = auth.uid())
    and (trip_id is null or public.is_member(trip_id))
  );
create policy "own pocket uses: remove" on public.pocket_uses for delete to authenticated using (user_id = auth.uid());
revoke all on public.pocket_uses from anon, authenticated;
grant select, insert, delete on public.pocket_uses to authenticated;

create table public.pocket_shares (
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 60),
  place_ids uuid[] not null check (cardinality(place_ids) between 1 and 200),
  created_at timestamptz not null default now()
);
create index pocket_shares_user_idx on public.pocket_shares (user_id);
alter table public.pocket_shares enable row level security;
revoke all on public.pocket_shares from anon, authenticated;

-- 建立分享連結：只收自己的地點
create or replace function public.pocket_share_create(p_ids uuid[], p_title text default '') returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ids uuid[];
  c text := substr(md5(gen_random_uuid()::text || gen_random_uuid()::text), 1, 16);
begin
  if uid is null then raise exception '請先登入'; end if;
  select coalesce(array_agg(p.id), '{}') into ids from public.pocket_places p where p.user_id = uid and p.id = any (coalesce(p_ids, '{}'));
  if cardinality(ids) = 0 then raise exception '沒有可以分享的地點'; end if;
  if cardinality(ids) > 200 then raise exception '一次最多分享 200 個地點'; end if;
  if (select count(*) from public.pocket_shares where user_id = uid) >= 50 then raise exception '分享連結太多了（上限 50 個），先刪掉用不到的'; end if;
  insert into public.pocket_shares (code, user_id, title, place_ids) values (c, uid, left(trim(coalesce(p_title, '')), 60), ids);
  return c;
end
$$;

-- 我分享出去的連結（count = 裡面現在還在的地點數）
create or replace function public.pocket_shares_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', s.code, 'title', s.title, 'created_at', s.created_at, 'ids', to_jsonb(s.place_ids),
    'count', (select count(*) from public.pocket_places p where p.user_id = s.user_id and p.id = any (s.place_ids))
  ) order by s.created_at desc), '[]'::jsonb)
  from public.pocket_shares s where s.user_id = auth.uid()
$$;

create or replace function public.pocket_share_delete(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.pocket_shares where code = p_code and user_id = auth.uid();
end
$$;

-- 打開別人的分享連結：要先登入。看得到名稱、地址、說明、備註、照片；看不到這些地點去過哪些行程。
create or replace function public.pocket_shared(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sh public.pocket_shares%rowtype;
begin
  if uid is null then raise exception '請先登入'; end if;
  select * into sh from public.pocket_shares where code = lower(trim(coalesce(p_code, '')));
  if not found then raise exception '這個分享連結已經失效'; end if;
  return jsonb_build_object(
    'code', sh.code, 'title', sh.title, 'owner', public.display_name(sh.user_id), 'mine', sh.user_id = uid,
    'places', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'kind', p.kind, 'category', p.category, 'city', p.city, 'q', p.q, 'addr', p.addr, 'tel', p.tel,
        's', p.s, 'note', p.note, 'details', p.details, 'photos', p.photos) order by p.category, p.name), '[]'::jsonb)
      from public.pocket_places p where p.user_id = sh.user_id and p.id = any (sh.place_ids)));
end
$$;

revoke all on function public.pocket_photos_ok(uuid, text[]), public.pocket_places_guard() from public, anon;
grant execute on function public.pocket_photos_ok(uuid, text[]) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.pocket_share_create(uuid[], text)', 'public.pocket_shares_mine()', 'public.pocket_share_delete(text)', 'public.pocket_shared(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- 照片：公開讀（網址裡有 user id 和亂數檔名，猜不到；用網址讀圖不需要 select policy），每張上限 2 MB。
-- 列出、上傳、刪除只有本人，而且只能在自己的資料夾。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pocket-photos', 'pocket-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "own pocket photos: list" on storage.objects;
drop policy if exists "own pocket photos: add" on storage.objects;
drop policy if exists "own pocket photos: remove" on storage.objects;
create policy "own pocket photos: list" on storage.objects
  for select to authenticated using (bucket_id = 'pocket-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own pocket photos: add" on storage.objects
  for insert to authenticated with check (bucket_id = 'pocket-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own pocket photos: remove" on storage.objects
  for delete to authenticated using (bucket_id = 'pocket-photos' and (storage.foldername(name))[1] = auth.uid()::text);
