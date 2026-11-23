-- 這一天和誰共用同一份行程：一個函式決定「我們家這一天要跟哪幾家看同一份」。
--
-- 一天的版本有三種（days.fam）：null = 大家一起；一家 = 那一家自己的；兩家以上 = 那幾家共用。
-- 前端原本只能「做一份自己的」和「改回大家一起」。要讓兩三家共用同一份，得同時動別家的列，
-- 一般成員的 RLS 做不到，所以放在 security definer 的函式裡，自己檢查權限。
--
-- 規則：
--   * 只能設定自己家那一天（管理員可以用 p_family 幫別家設定）。
--   * p_with = 要一起的其他家；空的 = 只有我們家。p_everyone = true 則是回到大家一起的版本。
--   * p_base = 用哪一家目前的那一份當共用的內容（預設自己家的）。
--   * 被拉進來的家如果那天已經有自己排好的內容，而且不是用他們那一份當底：一般成員不能做（會蓋掉別人的行程），管理員才可以。
--   * 原本跟我們共用、這次沒被選到的家：留在原本那一份，不受影響。
--   * 每一家原本的住宿跟共用那一份不同的話，記在 hotels 裡，不會被蓋掉。

create or replace function public.day_set_sharing(p_trip uuid, p_date text, p_with text[] default '{}', p_everyone boolean default false, p_base text default null, p_family text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me text := coalesce(p_family, public.my_family(p_trip));
  grp text[];
  base text;
  base_row public.days%rowtype;
  cur public.days%rowtype;
  f text;
  r record;
  hs jsonb;
  h text;
  rest text[];
begin
  if not public.is_editor(p_trip) then raise exception '觀察員不能改行程'; end if;
  if me is null or (me <> public.my_family(p_trip) and not public.is_admin(p_trip)) then raise exception '只能設定自己家的這一天'; end if;
  if not exists (select 1 from public.families where trip_id = p_trip and id = me) then raise exception '沒有這一家'; end if;

  if p_everyone then
    if not exists (select 1 from public.days where trip_id = p_trip and date_id = p_date and fam is null) then raise exception '這一天沒有大家一起的版本'; end if;
    for r in select id, fam from public.days where trip_id = p_trip and date_id = p_date and fam is not null and me = any (fam) for update loop
      rest := array_remove(r.fam, me);
      if cardinality(rest) = 0 then delete from public.days where id = r.id;
      else update public.days d set fam = rest, hotels = d.hotels - me, updated_at = now() where d.id = r.id; end if;
    end loop;
    return;
  end if;

  select coalesce(array_agg(distinct x order by x), '{}') into grp
    from unnest(array[me] || coalesce(p_with, '{}')) x
    where exists (select 1 from public.families fm where fm.trip_id = p_trip and fm.id = x);
  base := coalesce(p_base, me);
  if not (base = any (grp)) then raise exception '當底的那一份要是一起的其中一家'; end if;
  select * into base_row from public.days where id = public.family_day_row(p_trip, p_date, base);
  if not found then raise exception '%那一天還沒有行程', (select label from public.families where trip_id = p_trip and id = base); end if;

  -- 會不會蓋掉別家排好的內容
  if not public.is_admin(p_trip) then
    foreach f in array grp loop
      continue when f = me or f = base;
      select * into cur from public.days where id = public.family_day_row(p_trip, p_date, f);
      if found and cur.fam is not null and cur.id <> base_row.id and jsonb_array_length(cur.items) > 0 then
        raise exception '%那一天已經有自己排好的行程。可以改成用他們那一份當共用的版本，或請管理員處理', (select label from public.families where trip_id = p_trip and id = f);
      end if;
    end loop;
  end if;

  -- 每一家原本住哪（跟共用那一份不同的才記）
  hs := '{}'::jsonb;
  foreach f in array grp loop
    select coalesce(nullif(d.hotels ->> f, ''), d.hotel) into h from public.days d where d.id = public.family_day_row(p_trip, p_date, f);
    if coalesce(h, '') <> '' and h <> base_row.hotel then hs := hs || jsonb_build_object(f, h); end if;
  end loop;

  -- 這幾家離開他們現在那一份（列裡只剩他們就整列拿掉；還有別家就只把他們移出去）
  for r in select id, fam from public.days where trip_id = p_trip and date_id = p_date and fam is not null and fam && grp for update loop
    select coalesce(array_agg(x), '{}') into rest from unnest(r.fam) x where not (x = any (grp));
    if cardinality(rest) = 0 then delete from public.days where id = r.id;
    else update public.days d set fam = rest, hotels = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(d.hotels) e(k, v) where not (k = any (grp))), updated_at = now() where d.id = r.id; end if;
  end loop;

  insert into public.days (trip_id, date_id, fam, d, w, city, title, hotel, hotels, items)
    values (p_trip, p_date, grp, base_row.d, base_row.w, base_row.city, base_row.title, base_row.hotel, hs, base_row.items);
end
$$;

revoke all on function public.day_set_sharing(uuid, text, text[], boolean, text, text) from public, anon;
grant execute on function public.day_set_sharing(uuid, text, text[], boolean, text, text) to authenticated;
