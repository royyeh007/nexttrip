-- 我的家人（帳號層級）＋ 每個行程誰會去
--
-- households / household_people：一個家的名單。大人、小孩都可以沒有帳號；有帳號的大人（user_id）可以一起管理這份名單。
--   一個帳號最多在一個家裡。小孩的年齡：填生日就精確算；只填年齡的話記下是哪一天填的，之後照日期往上加。
-- trip_people：這個行程誰會去。兩種來源：
--   1. 某個家的人（person_id）：名字、年齡跟著名單走；由那個家有帳號的人自己勾選。
--   2. 沒有帳號的同行者（person_id 是 null，名字年齡直接記在這裡）：管理員或那一家的成員代填，例如沒用這個網站的長輩。
-- 地點的「誰參加」存在行程項目裡（items[].people = trip_people.id 的陣列，沒有這個欄位 = 全員）。
--
-- 跟好友那三張表一樣：開 RLS、不給 policy，全部經過 security definer 的函式。
-- 生日只有自己家看得到；同行的人只看得到名字、大人或小孩、旅行當時幾歲、備註。

create table public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.households enable row level security;

create table public.household_people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('adult', 'child')),
  birthday date,
  age_years integer check (age_years between 0 and 120),
  age_asof date,
  note text not null default '' check (char_length(note) <= 200),
  user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index household_people_household_idx on public.household_people (household_id);
alter table public.household_people enable row level security;

create table public.trip_people (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  family_id text not null,
  person_id uuid references public.household_people (id) on delete cascade,
  name text check (name is null or char_length(name) between 1 and 40),
  kind text check (kind is null or kind in ('adult', 'child')),
  age_years integer check (age_years between 0 and 120),
  note text not null default '' check (char_length(note) <= 200),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trip_id, person_id),
  foreign key (trip_id, family_id) references public.families (trip_id, id) on delete cascade,
  check (person_id is not null or (name is not null and kind is not null))
);
create index trip_people_trip_idx on public.trip_people (trip_id);
alter table public.trip_people enable row level security;

revoke all on public.households, public.household_people, public.trip_people from anon, authenticated;

-- ---- 內部用 ----

create or replace function public.my_household_id() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.household_people where user_id = auth.uid()
$$;

-- 沒有家就建一個，裡面先放自己（大人）
create or replace function public.ensure_household() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  h uuid;
begin
  if uid is null then raise exception '請先登入'; end if;
  select household_id into h from public.household_people where user_id = uid;
  if h is not null then return h; end if;
  insert into public.households default values returning id into h;
  insert into public.household_people (household_id, name, kind, user_id)
    values (h, left(coalesce(nullif(public.display_name(uid), '（沒有名字）'), '我'), 40), 'adult', uid);
  return h;
end
$$;

-- 某一天幾歲：有生日就照生日；只有年齡就從填的那天往後加；都沒有就是 null
create or replace function public.age_on(p_birthday date, p_age integer, p_asof date, p_day date) returns integer
language sql immutable set search_path = public as $$
  select case
    when p_birthday is not null then greatest(0, extract(year from age(p_day, p_birthday))::integer)
    when p_age is not null then greatest(0, p_age + case when p_asof is null then 0 else extract(year from age(greatest(p_day, p_asof), p_asof))::integer end)
    else null end
$$;

revoke all on function public.my_household_id(), public.ensure_household(), public.age_on(date, integer, date, date) from public, anon, authenticated;

-- ---- 我的家人 ----

create or replace function public.my_household() returns jsonb
language plpgsql security definer set search_path = public as $$
declare h uuid := public.ensure_household();
begin
  return jsonb_build_object('id', h, 'people', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'kind', p.kind, 'birthday', p.birthday, 'note', p.note,
      'age', public.age_on(p.birthday, p.age_years, p.age_asof, current_date),
      'user_id', p.user_id, 'is_me', p.user_id = auth.uid(),
      'email', case when p.user_id is null then null else (select a.email from auth.users a where a.id = p.user_id) end
    ) order by (p.kind = 'child'), p.created_at), '[]'::jsonb)
    from public.household_people p where p.household_id = h));
end
$$;

-- 新增（p_id 是 null）或修改一位家人。有生日就用生日算年齡，沒有就記「今天幾歲」。
create or replace function public.household_save_person(p_id uuid, p_name text, p_kind text, p_age integer default null, p_birthday date default null, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  h uuid := public.ensure_household();
  n text := trim(coalesce(p_name, ''));
  nt text := trim(coalesce(p_note, ''));
  r uuid;
begin
  if n = '' or char_length(n) > 40 then raise exception '名字要填，最多 40 個字'; end if;
  if p_kind not in ('adult', 'child') then raise exception '請選大人或小孩'; end if;
  if char_length(nt) > 200 then raise exception '備註最多 200 個字'; end if;
  if p_age is not null and (p_age < 0 or p_age > 120) then raise exception '年齡不對'; end if;
  if p_birthday is not null and (p_birthday > current_date or p_birthday < current_date - interval '120 years') then raise exception '生日不對'; end if;
  if p_id is null then
    if (select count(*) from public.household_people where household_id = h) >= 20 then raise exception '家人最多 20 位'; end if;
    insert into public.household_people (household_id, name, kind, birthday, age_years, age_asof, note)
      values (h, n, p_kind, p_birthday, case when p_birthday is null then p_age end, case when p_birthday is null and p_age is not null then current_date end, nt)
      returning id into r;
  else
    update public.household_people
      set name = n, kind = p_kind, birthday = p_birthday,
          age_years = case when p_birthday is null then p_age end,
          age_asof = case when p_birthday is null and p_age is not null then current_date end,
          note = nt
      where id = p_id and household_id = h
      returning id into r;
    if r is null then raise exception '找不到這位家人'; end if;
  end if;
  return r;
end
$$;

create or replace function public.household_remove_person(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  h uuid := public.ensure_household();
  u uuid;
begin
  select user_id into u from public.household_people where id = p_id and household_id = h;
  if not found then raise exception '找不到這位家人'; end if;
  if u is not null then raise exception '這位家人連著一個帳號，請先解除連結'; end if;
  delete from public.household_people where id = p_id; -- 他在各個行程的「誰會去」跟著消失（cascade）
end
$$;

-- 把名單裡的一位大人連到好友的帳號：之後他也能管理這份名單。
-- 對方如果已經有自己的名單而且裡面有別人，要他先離開那一份；只有他自己一個人的話，直接併過來（他在各行程的「誰會去」跟著搬）。
create or replace function public.household_link_adult(p_person uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  h uuid := public.ensure_household();
  theirs uuid;
  their_person uuid;
begin
  if not exists (select 1 from public.household_people where id = p_person and household_id = h and kind = 'adult' and user_id is null) then raise exception '只能連結名單裡還沒有帳號的大人'; end if;
  if not exists (select 1 from public.friends where user_id = uid and friend_id = p_user) then raise exception '只能連結你的好友'; end if;
  select household_id, id into theirs, their_person from public.household_people where user_id = p_user;
  if theirs = h then raise exception '他已經在你的名單裡了'; end if;
  if theirs is not null then
    if (select count(*) from public.household_people where household_id = theirs) > 1 then raise exception '對方已經有自己的家人名單。請他先到「帳號・好友」離開那一份'; end if;
    update public.trip_people tp set person_id = p_person
      where tp.person_id = their_person and not exists (select 1 from public.trip_people x where x.trip_id = tp.trip_id and x.person_id = p_person);
    delete from public.households where id = theirs;
  end if;
  update public.household_people set user_id = p_user where id = p_person;
end
$$;

-- 解除帳號連結（解除自己的 = 離開這份名單；那位大人留在名單上，只是不再連著帳號）
create or replace function public.household_unlink(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_household_id();
begin
  if h is null then return; end if;
  if (select count(*) from public.household_people where household_id = h and user_id is not null) <= 1 then raise exception '名單至少要有一個人連著帳號，不然就沒有人能管理了'; end if;
  update public.household_people set user_id = null where id = p_person and household_id = h;
end
$$;

-- ---- 這個行程誰會去 ----

create or replace function public.trip_people_list(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  h uuid := public.my_household_id();
  d date;
begin
  if not public.is_member(p_trip) then raise exception '你不在這個行程裡'; end if;
  select start_date into d from public.trips where id = p_trip;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', tp.id, 'family_id', tp.family_id, 'guest', tp.person_id is null,
      'name', coalesce(hp.name, tp.name), 'kind', coalesce(hp.kind, tp.kind),
      'age', case when hp.id is not null then public.age_on(hp.birthday, hp.age_years, hp.age_asof, d) else tp.age_years end,
      'note', case when hp.id is not null then hp.note else tp.note end,
      'user_id', hp.user_id, 'person_id', tp.person_id,
      'mine', hp.household_id is not null and hp.household_id = h
    ) order by tp.family_id, (coalesce(hp.kind, tp.kind) = 'child'), tp.created_at), '[]'::jsonb)
    from public.trip_people tp left join public.household_people hp on hp.id = tp.person_id
    where tp.trip_id = p_trip);
end
$$;

-- 我們家這趟誰會去：傳整份名單（家人的 id），沒在名單裡的就從這個行程拿掉
create or replace function public.set_trip_people(p_trip uuid, p_people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  h uuid;
  fam text := public.my_family(p_trip);
  list uuid[] := coalesce(p_people, '{}');
begin
  if fam is null then raise exception '你不在這個行程裡'; end if;
  h := public.ensure_household();
  if exists (select 1 from unnest(list) x where not exists (select 1 from public.household_people hp where hp.id = x and hp.household_id = h)) then raise exception '只能選自己家的人'; end if;
  delete from public.trip_people tp using public.household_people hp
    where tp.trip_id = p_trip and hp.id = tp.person_id and hp.household_id = h and not (tp.person_id = any (list));
  insert into public.trip_people (trip_id, family_id, person_id, added_by)
    select p_trip, fam, x, auth.uid() from unnest(list) x
    on conflict (trip_id, person_id) do update set family_id = excluded.family_id;
end
$$;

-- 沒有帳號的同行者：管理員可以幫任何一家加；成員（不是觀察員）可以幫自己家加
create or replace function public.trip_guest_save(p_trip uuid, p_id uuid, p_family text, p_name text, p_kind text, p_age integer default null, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  n text := trim(coalesce(p_name, ''));
  nt text := trim(coalesce(p_note, ''));
  r uuid;
begin
  if not (public.is_admin(p_trip) or (public.is_editor(p_trip) and public.my_family(p_trip) = p_family)) then raise exception '只能幫自己家加人（管理員可以幫每一家加）'; end if;
  if not exists (select 1 from public.families where trip_id = p_trip and id = p_family) then raise exception '沒有這一家'; end if;
  if n = '' or char_length(n) > 40 then raise exception '名字要填，最多 40 個字'; end if;
  if p_kind not in ('adult', 'child') then raise exception '請選大人或小孩'; end if;
  if char_length(nt) > 200 then raise exception '備註最多 200 個字'; end if;
  if p_age is not null and (p_age < 0 or p_age > 120) then raise exception '年齡不對'; end if;
  if p_id is null then
    if (select count(*) from public.trip_people where trip_id = p_trip) >= 200 then raise exception '這個行程的人數到上限了（200 位）'; end if;
    insert into public.trip_people (trip_id, family_id, name, kind, age_years, note, added_by) values (p_trip, p_family, n, p_kind, p_age, nt, auth.uid()) returning id into r;
  else
    update public.trip_people set family_id = p_family, name = n, kind = p_kind, age_years = p_age, note = nt
      where id = p_id and trip_id = p_trip and person_id is null returning id into r;
    if r is null then raise exception '找不到這位同行者'; end if;
  end if;
  return r;
end
$$;

-- 從這個行程拿掉一個人：管理員都可以；自己家的人自己可以；代填的同行者，那一家的成員可以
create or replace function public.trip_person_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp public.trip_people%rowtype;
begin
  select * into tp from public.trip_people where id = p_id;
  if not found then return; end if;
  if not (public.is_admin(tp.trip_id)
       or (tp.person_id is not null and exists (select 1 from public.household_people hp where hp.id = tp.person_id and hp.household_id = public.my_household_id()))
       or (tp.person_id is null and public.is_editor(tp.trip_id) and public.my_family(tp.trip_id) = tp.family_id)) then
    raise exception '你不能拿掉這個人';
  end if;
  delete from public.trip_people where id = p_id;
end
$$;

-- 團員換家庭、退出行程時，他家的「誰會去」跟著走
create or replace function public.members_sync_trip_people() returns trigger
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  select household_id into h from public.household_people where user_id = old.user_id;
  if h is null then if tg_op = 'DELETE' then return old; end if; return new; end if;
  if tg_op = 'UPDATE' then
    if new.family_id is distinct from old.family_id then
      update public.trip_people tp set family_id = new.family_id from public.household_people hp
        where tp.trip_id = new.trip_id and hp.id = tp.person_id and hp.household_id = h;
    end if;
    return new;
  end if;
  -- 退出：同一個家還有別的帳號在這個行程裡，就留著
  if not exists (select 1 from public.members m join public.household_people hp on hp.user_id = m.user_id
                 where m.trip_id = old.trip_id and hp.household_id = h and m.user_id <> old.user_id) then
    delete from public.trip_people tp using public.household_people hp where tp.trip_id = old.trip_id and hp.id = tp.person_id and hp.household_id = h;
  end if;
  return old;
end
$$;
revoke all on function public.members_sync_trip_people() from public, anon, authenticated;
create trigger members_sync_trip_people after update or delete on public.members for each row execute function public.members_sync_trip_people();

do $$
declare f text;
begin
  foreach f in array array[
    'public.my_household()', 'public.household_save_person(uuid, text, text, integer, date, text)', 'public.household_remove_person(uuid)',
    'public.household_link_adult(uuid, uuid)', 'public.household_unlink(uuid)',
    'public.trip_people_list(uuid)', 'public.set_trip_people(uuid, uuid[])',
    'public.trip_guest_save(uuid, uuid, text, text, text, integer, text)', 'public.trip_person_remove(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
