-- 誰會去：自己勾選時，如果這一家已經有人幫忙代填了同名的人，把那一筆代填直接變成本人，不再多出一筆同名的。
-- 用「變成本人」而不是「刪掉代填再新增」：每一站的「誰參加」記的是這一筆的編號，編號不變，之前選好的誰去才不會跑掉。
-- 名字不分大小寫、頭尾空白不算；同名的代填有好幾筆時只接手最早的那一筆。

create or replace function public.set_trip_people(p_trip uuid, p_people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  h uuid;
  fam text := public.my_family(p_trip);
  list uuid[] := coalesce(p_people, '{}');
  x uuid;
  g uuid;
begin
  if fam is null then raise exception '你不在這個行程裡'; end if;
  h := public.ensure_household();
  if exists (select 1 from unnest(list) x where not exists (select 1 from public.household_people hp where hp.id = x and hp.household_id = h)) then raise exception '只能選自己家的人'; end if;
  delete from public.trip_people tp using public.household_people hp
    where tp.trip_id = p_trip and hp.id = tp.person_id and hp.household_id = h and not (tp.person_id = any (list));
  foreach x in array list loop
    if exists (select 1 from public.trip_people where trip_id = p_trip and person_id = x) then
      update public.trip_people set family_id = fam where trip_id = p_trip and person_id = x and family_id <> fam;
      continue;
    end if;
    select tp.id into g from public.trip_people tp, public.household_people hp
      where hp.id = x and tp.trip_id = p_trip and tp.family_id = fam and tp.person_id is null
        and lower(trim(tp.name)) = lower(trim(hp.name))
      order by tp.created_at limit 1;
    if g is not null then
      update public.trip_people set person_id = x, name = null, kind = null, age_years = null, note = '' where id = g;
    else
      insert into public.trip_people (trip_id, family_id, person_id, added_by) values (p_trip, fam, x, auth.uid());
    end if;
  end loop;
end
$$;

revoke all on function public.set_trip_people(uuid, uuid[]) from public, anon;
grant execute on function public.set_trip_people(uuid, uuid[]) to authenticated;
