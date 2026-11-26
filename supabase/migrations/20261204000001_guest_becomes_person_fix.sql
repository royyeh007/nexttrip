-- 修正上一個：迴圈變數叫 x，跟檢查名單那一行的 unnest(list) x 撞名（column reference "x" is ambiguous），勾選誰會去會失敗。

create or replace function public.set_trip_people(p_trip uuid, p_people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  h uuid;
  fam text := public.my_family(p_trip);
  list uuid[] := coalesce(p_people, '{}');
  pid uuid;
  g uuid;
begin
  if fam is null then raise exception '你不在這個行程裡'; end if;
  h := public.ensure_household();
  if exists (select 1 from unnest(list) x where not exists (select 1 from public.household_people hp where hp.id = x and hp.household_id = h)) then raise exception '只能選自己家的人'; end if;
  delete from public.trip_people tp using public.household_people hp
    where tp.trip_id = p_trip and hp.id = tp.person_id and hp.household_id = h and not (tp.person_id = any (list));
  foreach pid in array list loop
    if exists (select 1 from public.trip_people where trip_id = p_trip and person_id = pid) then
      update public.trip_people set family_id = fam where trip_id = p_trip and person_id = pid and family_id <> fam;
      continue;
    end if;
    select tp.id into g from public.trip_people tp, public.household_people hp
      where hp.id = pid and tp.trip_id = p_trip and tp.family_id = fam and tp.person_id is null
        and lower(trim(tp.name)) = lower(trim(hp.name))
      order by tp.created_at limit 1;
    if g is not null then
      update public.trip_people set person_id = pid, name = null, kind = null, age_years = null, note = '' where id = g;
    else
      insert into public.trip_people (trip_id, family_id, person_id, added_by) values (p_trip, fam, pid, auth.uid());
    end if;
  end loop;
end
$$;

revoke all on function public.set_trip_people(uuid, uuid[]) from public, anon;
grant execute on function public.set_trip_people(uuid, uuid[]) to authenticated;
