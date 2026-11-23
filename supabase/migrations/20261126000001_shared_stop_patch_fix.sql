-- 修正 shared_stop_patch：改時間時要先把那一站從清單拿出來再照新時間放回去，
-- 原本的條件寫成 not (sid = X and …)：沒有 sid 的站比對結果是 null，整個條件變成 null，結果別的站全部被濾掉，只剩交通。
-- （20261126000000 已經套用到線上，所以用新的一支 migration 取代這個函式；那一支裡的同一行也一起改正，新環境不會再錯一次。）

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
