-- 好友、個人檔案、行程邀請（被邀請的人可以選加入或不加入）
--
-- 三張表都開 RLS 而且不給任何 policy：前端不能直接讀寫，全部經過下面的函式（security definer，自己檢查身分）。
-- 這樣「誰看得到誰的名字和 email」只有一個地方決定：互為好友，或在同一個行程裡。
--
-- 加好友的兩種方式：
--   1. 好友碼（或好友連結）：拿到碼就能加，雙方立刻互為好友。碼是隨機 12 碼，猜不到；外流了可以重新產生。
--   2. 同行的人：已經在同一個行程裡的人可以直接加。
-- 沒有「用 email 搜尋」：那會讓任何登入的人拿 email 來試誰有帳號。

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 40),
  friend_code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.friends (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
alter table public.friends enable row level security;

-- 一個人在一個行程最多一筆邀請。接受之後這一筆就刪掉（他已經在 members 裡了）；不加入的留著，管理員看得到。
create table public.trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  invited_by uuid references auth.users (id) on delete set null,
  role text not null default 'member' check (role in ('member', 'viewer', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (trip_id, user_id)
);
create index trip_invitations_user_idx on public.trip_invitations (user_id) where status = 'pending';
alter table public.trip_invitations enable row level security;

revoke all on public.profiles, public.friends, public.trip_invitations from anon, authenticated;

-- ---- 內部用（不開放給前端呼叫）----

create or replace function public.new_friend_code() returns text
language sql volatile set search_path = public as $$
  select substr(md5(gen_random_uuid()::text || gen_random_uuid()::text), 1, 12)
$$;

-- 取得（沒有就建立）自己的檔案。名字預設用最近開過的行程裡填的名字，沒有就用 email @ 前面那段。
create or replace function public.ensure_profile() returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p public.profiles%rowtype;
begin
  if uid is null then raise exception '請先登入'; end if;
  select * into p from public.profiles where user_id = uid;
  if found then return p; end if;
  insert into public.profiles (user_id, name, friend_code)
  values (
    uid,
    left(coalesce(
      (select m.name from public.members m where m.user_id = uid and coalesce(m.name, '') <> '' order by m.last_opened_at desc nulls last limit 1),
      nullif(split_part(coalesce((select u.email from auth.users u where u.id = uid), ''), '@', 1), ''),
      ''), 40),
    public.new_friend_code())
  on conflict (user_id) do nothing;
  select * into p from public.profiles where user_id = uid;
  return p;
end
$$;

-- 一個人顯示給別人看的名字：自己設的 → 行程裡填的 → email @ 前面那段
create or replace function public.display_name(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(p.name, '') from public.profiles p where p.user_id = u),
    (select m.name from public.members m where m.user_id = u and coalesce(m.name, '') <> '' order by m.last_opened_at desc nulls last limit 1),
    nullif(split_part(coalesce((select a.email from auth.users a where a.id = u), ''), '@', 1), ''),
    '（沒有名字）')
$$;

create or replace function public.person_json(u uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('user_id', u, 'name', public.display_name(u), 'email', (select a.email from auth.users a where a.id = u))
$$;

create or replace function public.shares_trip(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m1 join public.members m2 on m2.trip_id = m1.trip_id where m1.user_id = a and m2.user_id = b)
$$;

create or replace function public.befriend(a uuid, b uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if a = b then raise exception '不能加自己為好友'; end if;
  if (select count(*) from public.friends where user_id = a) >= 300 then raise exception '好友太多了（上限 300 位）'; end if;
  if (select count(*) from public.friends where user_id = b) >= 300 then raise exception '對方的好友已經滿了'; end if;
  insert into public.friends (user_id, friend_id) values (a, b), (b, a) on conflict do nothing;
end
$$;

revoke all on function public.new_friend_code(), public.ensure_profile(), public.display_name(uuid), public.person_json(uuid), public.shares_trip(uuid, uuid), public.befriend(uuid, uuid)
  from public, anon, authenticated;

-- ---- 個人檔案 ----

create or replace function public.my_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  p := public.ensure_profile();
  return jsonb_build_object('name', p.name, 'friend_code', p.friend_code);
end
$$;

create or replace function public.set_profile_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare n text := trim(coalesce(p_name, ''));
begin
  if char_length(n) > 40 then raise exception '名字最多 40 個字'; end if;
  perform public.ensure_profile();
  update public.profiles set name = n where user_id = auth.uid();
end
$$;

-- 好友碼外流了：換一個新的，舊的立刻失效（已經加的好友不受影響）
create or replace function public.reset_friend_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text := public.new_friend_code();
begin
  perform public.ensure_profile();
  update public.profiles set friend_code = c where user_id = auth.uid();
  return c;
end
$$;

-- ---- 好友 ----

create or replace function public.add_friend(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  other uuid;
begin
  if uid is null then raise exception '請先登入'; end if;
  perform public.ensure_profile();
  select user_id into other from public.profiles where friend_code = lower(trim(coalesce(p_code, '')));
  if other is null then raise exception '好友碼不對，或對方已經換了新的'; end if;
  if other = uid then raise exception '這是你自己的好友碼'; end if;
  perform public.befriend(uid, other);
  return public.person_json(other);
end
$$;

-- 同一個行程裡的人可以直接加
create or replace function public.add_friend_user(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception '請先登入'; end if;
  if not public.shares_trip(uid, p_user) then raise exception '只能直接加同一個行程裡的人；其他人請用好友碼'; end if;
  perform public.befriend(uid, p_user);
  return public.person_json(p_user);
end
$$;

-- 解除好友：兩邊一起解除。對方還沒回覆的行程邀請（我邀的）也收回。
create or replace function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception '請先登入'; end if;
  delete from public.friends where (user_id = uid and friend_id = p_user) or (user_id = p_user and friend_id = uid);
  delete from public.trip_invitations where status = 'pending' and ((invited_by = uid and user_id = p_user) or (invited_by = p_user and user_id = uid));
end
$$;

create or replace function public.my_friends() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.j ->> 'name'), '[]'::jsonb)
  from (select public.person_json(f.friend_id) as j from public.friends f where f.user_id = auth.uid()) x
$$;

-- 跟我在同一個行程、但還不是好友的人
create or replace function public.my_co_travellers() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.j ->> 'name'), '[]'::jsonb)
  from (
    select public.person_json(o.user_id) as j
    from (select distinct m2.user_id
          from public.members m1 join public.members m2 on m2.trip_id = m1.trip_id
          where m1.user_id = auth.uid() and m2.user_id <> auth.uid()
            and not exists (select 1 from public.friends f where f.user_id = auth.uid() and f.friend_id = m2.user_id)
          limit 200) o
  ) x
$$;

-- ---- 行程邀請 ----

-- 管理員邀請一位好友。對方之前按過「不加入」的話，再邀一次會重新變成待回覆。
create or replace function public.invite_friend(p_trip uuid, p_user uuid, p_role text default 'member') returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception '請先登入'; end if;
  if not public.is_admin(p_trip) then raise exception '只有管理員可以邀請'; end if;
  if p_role not in ('member', 'viewer', 'admin') then raise exception '角色不對'; end if;
  if not exists (select 1 from public.friends where user_id = uid and friend_id = p_user) then raise exception '只能邀請你的好友'; end if;
  if exists (select 1 from public.members where trip_id = p_trip and user_id = p_user) then raise exception '他已經在這個行程裡了'; end if;
  insert into public.trip_invitations (trip_id, user_id, invited_by, role)
  values (p_trip, p_user, uid, p_role)
  on conflict (trip_id, user_id) do update set invited_by = excluded.invited_by, role = excluded.role, status = 'pending', created_at = now(), responded_at = null;
end
$$;

create or replace function public.cancel_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select trip_id into t from public.trip_invitations where id = p_id;
  if t is null then return; end if;
  if not public.is_admin(t) then raise exception '只有管理員可以收回邀請'; end if;
  delete from public.trip_invitations where id = p_id;
end
$$;

-- 管理頁用：這個行程送出去的邀請（待回覆、不加入）
create or replace function public.trip_invitations_list(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_trip) then raise exception '只有管理員可以看'; end if;
  return (
    select coalesce(jsonb_agg(public.person_json(i.user_id) || jsonb_build_object('id', i.id, 'role', i.role, 'status', i.status, 'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
    from public.trip_invitations i where i.trip_id = p_trip);
end
$$;

-- 我收到、還沒回覆的邀請（含行程的基本資料和可以選的家庭）
create or replace function public.my_invitations() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'role', i.role, 'created_at', i.created_at,
    'invited_by', case when i.invited_by is null then null else public.display_name(i.invited_by) end,
    'trip', jsonb_build_object('id', t.id, 'name', t.name, 'start_date', t.start_date, 'end_date', t.end_date, 'place', t.place, 'settings', jsonb_build_object('icon', t.settings -> 'icon')),
    'families', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label) order by f.sort, f.id), '[]'::jsonb) from public.families f where f.trip_id = t.id)
  ) order by i.created_at desc), '[]'::jsonb)
  from public.trip_invitations i join public.trips t on t.id = i.trip_id
  where i.user_id = auth.uid() and i.status = 'pending'
$$;

-- 回覆邀請。加入：選一個已有的家庭，或填新的一家的名字。回傳行程 id（不加入回傳 null）。
create or replace function public.respond_invitation(p_id uuid, p_accept boolean, p_family text default null, p_new_family text default null, p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.trip_invitations%rowtype;
  fid text;
  nf text := trim(coalesce(p_new_family, ''));
  nm text := trim(coalesce(p_name, ''));
begin
  if uid is null then raise exception '請先登入'; end if;
  select * into inv from public.trip_invitations where id = p_id and user_id = uid and status = 'pending' for update;
  if not found then raise exception '這個邀請已經不在了（可能被收回了）'; end if;
  if not p_accept then
    update public.trip_invitations set status = 'declined', responded_at = now() where id = p_id;
    return null;
  end if;
  if exists (select 1 from public.members where trip_id = inv.trip_id and user_id = uid) then
    delete from public.trip_invitations where id = p_id;
    return inv.trip_id;
  end if;
  if char_length(nf) > 40 or char_length(nm) > 40 then raise exception '名字最多 40 個字'; end if;
  if nf <> '' then
    fid := 'f' || substr(md5(gen_random_uuid()::text), 1, 6);
    insert into public.families (trip_id, id, name, label, sort)
      values (inv.trip_id, fid, nf, nf, (select coalesce(max(sort), 0) + 1 from public.families where trip_id = inv.trip_id));
  else
    fid := p_family;
  end if;
  if fid is null or not exists (select 1 from public.families where trip_id = inv.trip_id and id = fid) then raise exception '請選你是哪一家'; end if;
  insert into public.members (trip_id, user_id, email, family_id, name, role, last_opened_at)
    values (inv.trip_id, uid, nullif(public.auth_email(), ''), fid, coalesce(nullif(nm, ''), nullif(public.display_name(uid), '（沒有名字）')), inv.role, now());
  delete from public.trip_invitations where id = p_id;
  return inv.trip_id;
end
$$;

-- 只給登入的人；anon 一律不能呼叫
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_profile()', 'public.set_profile_name(text)', 'public.reset_friend_code()',
    'public.add_friend(text)', 'public.add_friend_user(uuid)', 'public.remove_friend(uuid)', 'public.my_friends()', 'public.my_co_travellers()',
    'public.invite_friend(uuid, uuid, text)', 'public.cancel_invitation(uuid)', 'public.trip_invitations_list(uuid)',
    'public.my_invitations()', 'public.respond_invitation(uuid, boolean, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
