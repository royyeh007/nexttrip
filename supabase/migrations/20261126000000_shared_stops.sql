-- 共同的地點：各家那一天行程不同，但其中一站是一起的（例如中午一起吃飯）。
--
-- 做法：這一站在每一家那一天的行程裡各有一份（位置、前後的交通各家自己排），每一份帶同一個代號 sid。
-- 內容（時間、名稱、訂位、備註、誰參加…）要改的時候，經過這裡的函式一次改掉所有份，所以不會有哪一家看到舊的。
-- 「誰一起」不另外存：哪幾家那一天看到的行程裡有這個 sid，就是哪幾家一起。
--
-- 為什麼要用函式：一般成員只能寫自己家的那一列（RLS），這裡要同時改別家的列，所以用 security definer，自己檢查
-- 「呼叫的人是這個行程的成員（不是觀察員），而且他家那一天的行程裡有這一站」。

-- 某一家在某一天看到的是哪一列：自己家的 > 和別家合用的 > 大家一起的（和前端 daysFor 同一個順序）
create or replace function public.family_day_row(p_trip uuid, p_date text, p_fam text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.days
  where trip_id = p_trip and date_id = p_date and (fam is null or p_fam = any (fam))
  order by (case when fam is null then 0 when cardinality(fam) = 1 then 2 else 1 end) desc
  limit 1
$$;

-- 把一站照時間插進一天的行程：放在「時間不比它晚的最後一站」後面；都比它晚就放最前面
create or replace function public.items_insert_by_time(p_items jsonb, p_item jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  n integer := jsonb_array_length(p_items);
  pos integer := 0;
  i integer;
  e jsonb;
  t text := lpad(coalesce(p_item ->> 't', ''), 5, '0');
begin
  for i in 0 .. n - 1 loop
    e := p_items -> i;
    if not (e ? 'leg') and coalesce(e ->> 't', '') ~ '^\d{1,2}:\d{2}$' and lpad(e ->> 't', 5, '0') <= t then pos := i + 1; end if;
  end loop;
  return (
    select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb) from (
      select v, ord * 2 as o from jsonb_array_elements(p_items) with ordinality a(v, ord)
      union all
      select p_item, pos * 2 + 1
    ) x);
end
$$;

-- 把帶這個 sid 的那一站拿掉，連同通往它的那一段交通（和前端 removeStopAt 一樣：前面是交通就拿前面那段，否則拿後面那段）
create or replace function public.items_remove_sid(p_items jsonb, p_sid text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  n integer := jsonb_array_length(p_items);
  idx integer := null;
  i integer;
  lo integer;
  hi integer;
begin
  for i in 0 .. n - 1 loop
    if (p_items -> i) ->> 'sid' = p_sid and not ((p_items -> i) ? 'leg') then idx := i; exit; end if;
  end loop;
  if idx is null then return p_items; end if;
  lo := idx; hi := idx;
  if idx > 0 and (p_items -> (idx - 1)) ? 'leg' then lo := idx - 1;
  elsif idx + 1 < n and (p_items -> (idx + 1)) ? 'leg' then hi := idx + 1; end if;
  return (select coalesce(jsonb_agg(v order by ord), '[]'::jsonb) from jsonb_array_elements(p_items) with ordinality a(v, ord) where ord - 1 < lo or ord - 1 > hi);
end
$$;

create or replace function public.items_have_sid(p_items jsonb, p_sid text) returns boolean
language sql immutable set search_path = public as $$
  select exists (select 1 from jsonb_array_elements(p_items) e where e ->> 'sid' = p_sid and not (e ? 'leg'))
$$;

-- 呼叫的人能不能動這個共同的地點：成員（不是觀察員），而且他家那一天的行程裡有它；管理員都可以
create or replace function public.shared_stop_allowed(p_trip uuid, p_date text, p_sid text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_editor(p_trip) and (
    public.is_admin(p_trip)
    or exists (select 1 from public.days d where d.id = public.family_day_row(p_trip, p_date, public.my_family(p_trip)) and public.items_have_sid(d.items, p_sid)))
$$;

revoke all on function public.family_day_row(uuid, text, text), public.items_insert_by_time(jsonb, jsonb), public.items_remove_sid(jsonb, text),
  public.items_have_sid(jsonb, text), public.shared_stop_allowed(uuid, text, text) from public, anon, authenticated;

-- 把一站變成和別家一起的：在 p_fams 每一家那一天的行程裡放一份（照時間插入）。回傳這一站的 sid。
-- 對方那一天：有自己的版本就放進去；用的是「大家一起的版本」的話，如果用那個版本的每一家都在名單裡就直接放進去，
-- 否則幫被選到的那一家做一份自己的版本再放（不然沒被選到的家也會看到）；那一天什麼都沒有就幫他開一天。
create or replace function public.shared_stop_share(p_trip uuid, p_row uuid, p_t text, p_n text, p_fams text[]) returns text
language plpgsql security definer set search_path = public as $$
declare
  me text := public.my_family(p_trip);
  r public.days%rowtype;
  tgt public.days%rowtype;
  item jsonb;
  idx integer := null;
  i integer;
  sid text;
  f text;
  tid uuid;
  targets text[];
  everyone_users text[];
begin
  if not public.is_editor(p_trip) then raise exception '觀察員不能改行程'; end if;
  select * into r from public.days where id = p_row and trip_id = p_trip for update;
  if not found then raise exception '這一天已經不存在了'; end if;
  if not (r.fam is null or me = any (r.fam) or public.is_admin(p_trip)) then raise exception '只能分享自己家行程裡的地點'; end if;
  for i in 0 .. jsonb_array_length(r.items) - 1 loop
    if not ((r.items -> i) ? 'leg') and (r.items -> i) ->> 'n' = p_n and coalesce((r.items -> i) ->> 't', '') = coalesce(p_t, '') then idx := i; exit; end if;
  end loop;
  if idx is null then
    for i in 0 .. jsonb_array_length(r.items) - 1 loop
      if not ((r.items -> i) ? 'leg') and (r.items -> i) ->> 'n' = p_n then idx := i; exit; end if;
    end loop;
  end if;
  if idx is null then raise exception '這個地點已經被改掉了，重新打開再試'; end if;
  item := r.items -> idx;
  sid := item ->> 'sid';
  if sid is null then
    sid := 's' || substr(md5(gen_random_uuid()::text), 1, 10);
    item := item || jsonb_build_object('sid', sid);
    update public.days set items = jsonb_set(items, array[idx::text], item), updated_at = now() where id = r.id;
  end if;

  select coalesce(array_agg(distinct x), '{}') into targets from unnest(coalesce(p_fams, '{}')) x
    where exists (select 1 from public.families fm where fm.trip_id = p_trip and fm.id = x);
  -- 現在用「大家一起的版本」的是哪幾家（判斷能不能直接放進那個版本）
  select coalesce(array_agg(fm.id), '{}') into everyone_users from public.families fm
    where fm.trip_id = p_trip and exists (select 1 from public.days d where d.id = public.family_day_row(p_trip, r.date_id, fm.id) and d.fam is null);

  foreach f in array targets loop
    tid := public.family_day_row(p_trip, r.date_id, f);
    if tid is null then
      insert into public.days (trip_id, date_id, fam, d, w, city, title, hotel, items) values (p_trip, r.date_id, array[f], r.d, r.w, r.city, r.title, '', jsonb_build_array(item));
      continue;
    end if;
    select * into tgt from public.days where id = tid for update;
    if public.items_have_sid(tgt.items, sid) then continue; end if;
    if tgt.fam is null and not (everyone_users <@ (targets || coalesce(r.fam, array[me]))) then
      insert into public.days (trip_id, date_id, fam, d, w, city, title, hotel, items)
        values (p_trip, r.date_id, array[f], tgt.d, tgt.w, tgt.city, tgt.title, tgt.hotel, public.items_insert_by_time(tgt.items, item));
    else
      update public.days set items = public.items_insert_by_time(tgt.items, item), updated_at = now() where id = tid;
    end if;
  end loop;
  return sid;
end
$$;

-- 改共同地點的內容：每一份一起改。p_patch 的值是 null = 拿掉那個欄位。p_skip_row = 呼叫的人自己那一列（前端已經改好、排好順序了）。
-- 改了時間的話，別家那一份會照新的時間重新插入位置。
create or replace function public.shared_stop_patch(p_trip uuid, p_date text, p_sid text, p_patch jsonb, p_skip_row uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  allowed constant text[] := array['t', 'n', 'q', 'k', 'st', 'who', 's', 'info', 'book', 'rec', 'tips', 'addr', 'tel', 'memo', 'll', 'ref', 'people'];
  drop_keys text[];
  set_part jsonb;
  d record;
  next_items jsonb;
  item jsonb;
  n integer := 0;
begin
  if not public.shared_stop_allowed(p_trip, p_date, p_sid) then raise exception '你們家那一天的行程裡沒有這個共同的地點'; end if;
  if jsonb_typeof(p_patch) <> 'object' or length(p_patch::text) > 40000 then raise exception '內容太長或格式不對'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where not (k = any (allowed))) then raise exception '有不能改的欄位'; end if;
  select coalesce(array_agg(key), '{}') into drop_keys from jsonb_each(p_patch) where value = 'null'::jsonb;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into set_part from jsonb_each(p_patch) where value <> 'null'::jsonb;
  for d in select id, items from public.days where trip_id = p_trip and date_id = p_date and (p_skip_row is null or id <> p_skip_row) and public.items_have_sid(items, p_sid) for update loop
    select ((e || set_part) - drop_keys) into item from jsonb_array_elements(d.items) e where e ->> 'sid' = p_sid and not (e ? 'leg') limit 1;
    if set_part ? 't' then
      -- 時間變了：只把這一站移到新的位置，交通那幾段留在原地（那是各家自己排的）
      select coalesce(jsonb_agg(v order by ord), '[]'::jsonb) into next_items from jsonb_array_elements(d.items) with ordinality a(v, ord) where (v ->> 'sid') is distinct from p_sid or (v ? 'leg');
      if (select (e ->> 't') is distinct from (set_part ->> 't') from jsonb_array_elements(d.items) e where e ->> 'sid' = p_sid and not (e ? 'leg') limit 1) then
        next_items := public.items_insert_by_time(next_items, item);
      else
        select coalesce(jsonb_agg(case when v ->> 'sid' = p_sid and not (v ? 'leg') then item else v end order by ord), '[]'::jsonb) into next_items from jsonb_array_elements(d.items) with ordinality a(v, ord);
      end if;
    else
      select coalesce(jsonb_agg(case when v ->> 'sid' = p_sid and not (v ? 'leg') then item else v end order by ord), '[]'::jsonb) into next_items from jsonb_array_elements(d.items) with ordinality a(v, ord);
    end if;
    update public.days set items = next_items, updated_at = now() where id = d.id;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- 不再一起：把這一站從 p_fams 這幾家那一天的行程拿掉（p_fams 是 null = 每一家都拿掉，也就是整個取消）。
-- 拿到只剩一家有的時候，那一份就變回普通的地點（sid 拿掉）。
create or replace function public.shared_stop_unshare(p_trip uuid, p_date text, p_sid text, p_fams text[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  d record;
  n integer := 0;
  left_rows integer;
begin
  if not public.shared_stop_allowed(p_trip, p_date, p_sid) then raise exception '你們家那一天的行程裡沒有這個共同的地點'; end if;
  for d in select id, items from public.days where trip_id = p_trip and date_id = p_date and public.items_have_sid(items, p_sid)
             and (p_fams is null or id in (select public.family_day_row(p_trip, p_date, x) from unnest(p_fams) x)) for update loop
    update public.days set items = public.items_remove_sid(d.items, p_sid), updated_at = now() where id = d.id;
    n := n + 1;
  end loop;
  select count(*) into left_rows from public.days where trip_id = p_trip and date_id = p_date and public.items_have_sid(items, p_sid);
  if left_rows = 1 then
    update public.days set items = (select jsonb_agg(case when v ->> 'sid' = p_sid then v - 'sid' else v end order by ord) from jsonb_array_elements(items) with ordinality a(v, ord)), updated_at = now()
      where trip_id = p_trip and date_id = p_date and public.items_have_sid(items, p_sid);
  end if;
  return n;
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.shared_stop_share(uuid, uuid, text, text, text[])',
    'public.shared_stop_patch(uuid, text, text, jsonb, uuid)',
    'public.shared_stop_unshare(uuid, text, text, text[])'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
