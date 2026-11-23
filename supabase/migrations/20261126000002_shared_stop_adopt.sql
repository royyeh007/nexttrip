-- 分享時，對方那一天如果本來就有「同名、同時間」的一站（例如他是複製整天之後各自改的），就把那一站直接綁成同一個，
-- 內容以分享出來的這一份為準，位置和前後的交通不動；沒有才照時間插入一份新的。原本一律插入，會變成兩個一樣的站。

create or replace function public.items_adopt_or_insert(p_items jsonb, p_item jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  i integer;
  e jsonb;
begin
  for i in 0 .. jsonb_array_length(p_items) - 1 loop
    e := p_items -> i;
    if not (e ? 'leg') and not (e ? 'sid') and e ->> 'n' = p_item ->> 'n' and coalesce(e ->> 't', '') = coalesce(p_item ->> 't', '') then
      -- 對方那一份上面的備註留著（接在後面）
      return jsonb_set(p_items, array[i::text],
        case when jsonb_typeof(e -> 'memo') = 'array' and jsonb_array_length(e -> 'memo') > 0
             then p_item || jsonb_build_object('memo', coalesce(p_item -> 'memo', '[]'::jsonb) || (e -> 'memo')) else p_item end);
    end if;
  end loop;
  return public.items_insert_by_time(p_items, p_item);
end
$$;
revoke all on function public.items_adopt_or_insert(jsonb, jsonb) from public, anon, authenticated;

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
        values (p_trip, r.date_id, array[f], tgt.d, tgt.w, tgt.city, tgt.title, tgt.hotel, public.items_adopt_or_insert(tgt.items, item));
    else
      update public.days set items = public.items_adopt_or_insert(tgt.items, item), updated_at = now() where id = tid;
    end if;
  end loop;
  return sid;
end
$$;
