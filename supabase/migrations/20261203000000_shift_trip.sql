-- 整份行程換日期：管理員改開始日期時，已經排好的每一天一起移同樣的天數（成員、聊天、待辦都留在原地）。
-- 行程的開始、結束日期和天氣地點（照日期記的）也跟著移。回傳移了幾個日子。

create or replace function public.shift_trip(p_trip uuid, p_start date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  src public.trips%rowtype;
  delta int;
  cfg jsonb;
  n int;
  wk text[] := array['日', '一', '二', '三', '四', '五', '六'];
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  if not public.is_admin(p_trip) then raise exception '只有管理員可以改行程日期'; end if;
  if p_start is null then raise exception '要填開始日期'; end if;
  select * into src from public.trips where id = p_trip for update;
  if not found then raise exception '找不到這個行程'; end if;
  delta := p_start - src.start_date;
  if delta = 0 then return 0; end if;
  if abs(delta) > 3660 then raise exception '日期差太遠了'; end if;

  -- 同一個行程裡（日期、哪幾家）不能重複。新舊日期重疊時直接改會撞到還沒移的那一天，
  -- 所以先全部改成前面加 ~ 的新日期，再把 ~ 拿掉。
  update public.days d set
      date_id = '~' || to_char(d.date_id::date + delta, 'YYYY-MM-DD'),
      d = extract(month from d.date_id::date + delta)::int || '/' || extract(day from d.date_id::date + delta)::int,
      w = wk[extract(dow from d.date_id::date + delta)::int + 1],
      updated_at = now()
    where d.trip_id = p_trip and d.date_id ~ '^\d{4}-\d{2}-\d{2}$';
  get diagnostics n = row_count;
  update public.days d set date_id = substr(d.date_id, 2) where d.trip_id = p_trip and d.date_id like '~%';

  cfg := coalesce(src.settings, '{}'::jsonb);
  if jsonb_typeof(cfg -> 'day_places') = 'object' then
    cfg := cfg || jsonb_build_object('day_places', (
      select coalesce(jsonb_object_agg(case when k ~ '^\d{4}-\d{2}-\d{2}$' then to_char(k::date + delta, 'YYYY-MM-DD') else k end, v), '{}'::jsonb)
      from jsonb_each(cfg -> 'day_places') e(k, v)));
  end if;
  update public.trips set start_date = src.start_date + delta, end_date = src.end_date + delta, settings = cfg where id = p_trip;
  return n;
end
$$;

revoke all on function public.shift_trip(uuid, date) from public, anon;
grant execute on function public.shift_trip(uuid, date) to authenticated;
