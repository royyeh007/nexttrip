-- 複製行程：管理員把一個行程整份複製成新的（可以換名字、換出發日）。
-- 複製：行程設定、各家、每一天（含各家自己的版本、住宿）、這趟誰會去、待辦（全部變成未完成）、聯絡資料、資訊頁、雜項。
-- 不複製：成員（新行程只有複製的人，當管理員）、邀請碼和邀請、聊天紀錄、上傳的檔案。
-- 換了出發日，每一天的日期、星期、天氣地點都跟著往後（或往前）移同樣的天數。

create or replace function public.copy_trip(p_trip uuid, p_name text, p_start date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  src public.trips%rowtype;
  me public.members%rowtype;
  t uuid := gen_random_uuid();
  nm text := trim(coalesce(p_name, ''));
  st date;
  delta int;
  cfg jsonb;
  olds text[] := '{}';
  news text[] := '{}';
  nid uuid;
  nd date;
  txt text;
  r record;
  i int;
  wk text[] := array['日', '一', '二', '三', '四', '五', '六'];
begin
  if uid is null then raise exception '請先登入'; end if;
  if not public.is_admin(p_trip) then raise exception '只有管理員可以複製行程'; end if;
  select * into src from public.trips where id = p_trip;
  if not found then raise exception '找不到這個行程'; end if;
  select * into me from public.members where trip_id = p_trip and user_id = uid;
  if nm = '' then raise exception '行程要有名字'; end if;
  if char_length(nm) > 80 then raise exception '行程名字太長'; end if;
  if (select count(*) from public.trips where created_by = uid) >= 100 then raise exception '你建立的行程太多了，先刪掉一些再複製'; end if;
  st := coalesce(p_start, src.start_date);
  delta := st - src.start_date;

  -- 天氣要看的地點是照日期記的：日期跟著移
  cfg := coalesce(src.settings, '{}'::jsonb);
  if jsonb_typeof(cfg -> 'day_places') = 'object' then
    cfg := cfg || jsonb_build_object('day_places', (
      select coalesce(jsonb_object_agg(case when k ~ '^\d{4}-\d{2}-\d{2}$' then to_char(k::date + delta, 'YYYY-MM-DD') else k end, v), '{}'::jsonb)
      from jsonb_each(cfg -> 'day_places') e(k, v)));
  end if;

  insert into public.trips (id, name, start_date, end_date, place, tz, settings, created_by)
    values (t, nm, st, src.end_date + delta, src.place, src.tz, cfg, uid);

  insert into public.families
    select (jsonb_populate_record(null::public.families, to_jsonb(f) || jsonb_build_object('trip_id', t))).*
    from public.families f where f.trip_id = p_trip;

  insert into public.members (trip_id, user_id, email, family_id, name, role, last_opened_at)
    values (t, uid, me.email, me.family_id, me.name, 'admin', now());

  -- 這趟誰會去：每個人拿到新的編號，行程裡「誰參加」記的編號等一下跟著換
  for r in select * from public.trip_people where trip_id = p_trip order by created_at loop
    nid := gen_random_uuid();
    insert into public.trip_people (id, trip_id, family_id, person_id, name, kind, age_years, note, added_by)
      values (nid, t, r.family_id, r.person_id, r.name, r.kind, r.age_years, r.note, uid);
    olds := olds || r.id::text; news := news || nid::text;
  end loop;

  for r in select * from public.days where trip_id = p_trip loop
    txt := r.items::text;
    for i in 1 .. coalesce(array_length(olds, 1), 0) loop txt := replace(txt, olds[i], news[i]); end loop;
    if r.date_id ~ '^\d{4}-\d{2}-\d{2}$' and delta <> 0 then
      nd := r.date_id::date + delta;
      insert into public.days (trip_id, date_id, fam, d, w, city, title, hotel, hotels, items)
        values (t, to_char(nd, 'YYYY-MM-DD'), r.fam, extract(month from nd)::int || '/' || extract(day from nd)::int, wk[extract(dow from nd)::int + 1], r.city, r.title, r.hotel, r.hotels, txt::jsonb);
    else
      insert into public.days (trip_id, date_id, fam, d, w, city, title, hotel, hotels, items)
        values (t, r.date_id, r.fam, r.d, r.w, r.city, r.title, r.hotel, r.hotels, txt::jsonb);
    end if;
  end loop;

  insert into public.todos
    select (jsonb_populate_record(null::public.todos, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'trip_id', t, 'done', false))).*
    from public.todos x where x.trip_id = p_trip;
  insert into public.contacts
    select (jsonb_populate_record(null::public.contacts, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'trip_id', t))).*
    from public.contacts x where x.trip_id = p_trip;
  insert into public.info_pages
    select (jsonb_populate_record(null::public.info_pages, to_jsonb(x) || jsonb_build_object('trip_id', t))).*
    from public.info_pages x where x.trip_id = p_trip;
  insert into public.extras
    select (jsonb_populate_record(null::public.extras, to_jsonb(x) || jsonb_build_object('trip_id', t))).*
    from public.extras x where x.trip_id = p_trip;

  return t;
end
$$;

revoke all on function public.copy_trip(uuid, text, date) from public, anon;
grant execute on function public.copy_trip(uuid, text, date) to authenticated;
