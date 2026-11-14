-- 2026-11-15 程式碼審查後的權限和資料完整性強化。整份可以重複執行。
-- 前端和 Edge Function 在這份還沒套用時也能正常運作；套用後才真正關掉下面這些洞。

-- ---------- 1. 「其他資訊」的圖片：不能再被任何人列出來 ----------
-- bucket 是公開的，用網址讀圖本來就不需要 select policy；原本那條沒有限定對象，等於讓沒登入的人也能列出每個行程的所有檔名。
-- 改成只有那個行程的成員能列（刪頁時要列出、刪掉用過的圖也需要它）。
drop policy if exists "anyone reads info images" on storage.objects;
drop policy if exists "members list info images" on storage.objects;
create policy "members list info images" on storage.objects
  for select to authenticated
  using (bucket_id = 'info-images' and public.is_member(public.try_uuid((storage.foldername(name))[1])));

-- 上傳整理的檔案：10 MB 上限（原本沒有上限）
update storage.buckets set file_size_limit = 10485760 where id = 'uploads';

-- ---------- 2. 信用卡庫：只有「至少在一個行程裡是成員或管理員」的人能新增、修改 ----------
create or replace function public.is_any_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role in ('member', 'admin'))
$$;
revoke all on function public.is_any_editor() from public, anon;
grant execute on function public.is_any_editor() to authenticated;

drop policy if exists "signed-in add cards" on public.card_catalog;
drop policy if exists "signed-in edit cards" on public.card_catalog;
drop policy if exists "editors add cards" on public.card_catalog;
drop policy if exists "editors edit cards" on public.card_catalog;
create policy "editors add cards" on public.card_catalog for insert to authenticated
  with check (public.is_any_editor() and created_by = auth.uid());
create policy "editors edit cards" on public.card_catalog for update to authenticated
  using (public.is_any_editor()) with check (public.is_any_editor());

-- 誰建的、誰改的、什麼時候改的由伺服器寫，不能自己填（原本改掉 created_by 就能繞過「只有建立者能刪」）。
-- service role（種子、後台）沒有 auth.uid()，照給的值存。
create or replace function public.card_catalog_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.created_by := old.created_by;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists card_catalog_stamp on public.card_catalog;
create trigger card_catalog_stamp before insert or update on public.card_catalog
  for each row execute function public.card_catalog_stamp();

-- 形狀檢查（not valid：不回頭檢查既有的列，之後的新增和修改才檢查）
alter table public.card_catalog drop constraint if exists card_catalog_rates_array;
alter table public.card_catalog add constraint card_catalog_rates_array check (jsonb_typeof(rates) = 'array') not valid;
alter table public.card_catalog drop constraint if exists card_catalog_fx_fee_range;
alter table public.card_catalog add constraint card_catalog_fx_fee_range check (fx_fee >= 0 and fx_fee <= 10) not valid;
alter table public.card_catalog drop constraint if exists card_catalog_country_known;
alter table public.card_catalog add constraint card_catalog_country_known check (country in ('us', 'uk', 'tw', 'jp', 'kr', 'other')) not valid;
alter table public.card_catalog drop constraint if exists card_catalog_text_lengths;
alter table public.card_catalog add constraint card_catalog_text_lengths
  check (char_length(id) between 1 and 80 and char_length(name) between 1 and 80 and char_length(short) <= 24 and char_length(bank) <= 60
         and char_length(cap) <= 300 and char_length(conditions) <= 600 and char_length(source) <= 500) not valid;

-- ---------- 3. 上傳／提案紀錄：只能改審核狀態，而且要還在這個行程裡 ----------
drop policy if exists "update own uploads" on public.uploads;
create policy "update own uploads" on public.uploads
  for update to authenticated
  using ((uploaded_by = auth.uid()::text and public.is_editor(trip_id)) or public.is_admin(trip_id))
  with check ((uploaded_by = auth.uid()::text and public.is_editor(trip_id)) or public.is_admin(trip_id));
-- 網頁只會改這三欄；提案內容（parsed）、屬於哪個行程和哪一家只有 Edge Function（service role）能寫
revoke update on public.uploads from authenticated, anon;
grant update (status, reviewed_at, reviewed_by) on public.uploads to authenticated;

-- 有過上傳或提案的家庭原本刪不掉（外鍵擋住）：刪家庭時連它的上傳紀錄一起刪
alter table public.uploads drop constraint if exists uploads_family_fk;
alter table public.uploads add constraint uploads_family_fk
  foreign key (trip_id, family_id) references public.families (trip_id, id) on delete cascade;
create index if not exists uploads_trip_created_idx on public.uploads (trip_id, created_at desc);

-- ---------- 4. 成員名單：管理員只能改角色和換家（不能把別人的帳號搬進自己的行程） ----------
revoke update on public.members from authenticated, anon;
grant update (role, family_id) on public.members to authenticated;

-- ---------- 5. 建立行程：要在某個行程裡是成員或管理員（觀察員不行） ----------
create or replace function public.create_trip(p_name text, p_start date, p_end date, p_place text, p_family_label text, p_my_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  e text := public.auth_email();
  t uuid;
  fid text := 'f' || substr(md5(gen_random_uuid()::text), 1, 6);
  flabel text := coalesce(nullif(trim(p_family_label), ''), '我們家');
begin
  if uid is null then raise exception '請先登入'; end if;
  if not exists (select 1 from public.members where user_id = uid) then
    raise exception '要先用邀請碼加入一個行程，之後才能建立自己的行程';
  end if;
  if not exists (select 1 from public.members where user_id = uid and role in ('member', 'admin')) then
    raise exception '觀察員不能建立行程，請原本行程的管理員把你改成成員';
  end if;
  if p_name is null or trim(p_name) = '' then raise exception '行程要有名字'; end if;
  if char_length(trim(p_name)) > 80 then raise exception '行程名字太長'; end if;
  if p_start is null or p_end is null then raise exception '要填開始和結束日期'; end if;
  if p_end < p_start then raise exception '結束日期不能比開始早'; end if;
  insert into public.trips (name, start_date, end_date, place, created_by)
    values (trim(p_name), p_start, p_end, left(coalesce(trim(p_place), ''), 200), uid) returning id into t;
  insert into public.families (trip_id, id, name, label, sort) values (t, fid, left(flabel, 40), left(flabel, 40), 0);
  insert into public.members (trip_id, user_id, email, family_id, name, role, last_opened_at)
    values (t, uid, nullif(e, ''), fid, nullif(left(trim(coalesce(p_my_name, '')), 40), ''), 'admin', now());
  return t;
end
$$;

-- 這幾個函式本來就只給登入的人用；Supabase 預設也給了 anon 執行權，收回來（invite_valid 要留給還沒登入的人看邀請內容）
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_trip(text, date, date, text, text, text)',
    'public.join_with_invite(text, text, text, text)',
    'public.leave_trip(uuid)',
    'public.open_trip(uuid)',
    'public.set_my_name(uuid, text)'
  ] loop
    begin
      execute format('revoke execute on function %s from anon, public', f);
      execute format('grant execute on function %s to authenticated', f);
    exception when undefined_function then
      raise notice '沒有這個函式，略過：%', f;
    end;
  end loop;
end $$;

-- ---------- 6. 邀請：新的邀請預設 30 天到期（既有的不動，管理頁會標出「沒有期限」的舊邀請） ----------
alter table public.invites alter column expires_at set default (now() + interval '30 days');

-- ---------- 7. 形狀檢查：一筆壞資料不該讓整個行程打不開 ----------
alter table public.days drop constraint if exists days_items_array;
alter table public.days add constraint days_items_array check (jsonb_typeof(items) = 'array') not valid;
alter table public.days drop constraint if exists days_fam_not_empty;
alter table public.days add constraint days_fam_not_empty check (fam is null or cardinality(fam) > 0) not valid;

-- 其他資訊：修改時間和修改的人由伺服器寫（兩個人同時改時，用它判斷「我讀到的版本還是不是最新的」）
create or replace function public.info_pages_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists info_pages_stamp on public.info_pages;
create trigger info_pages_stamp before insert or update on public.info_pages
  for each row execute function public.info_pages_stamp();

-- ---------- 8. AI 用量：每個人、每個行程的每日上限都用 ai_calls 計數（先記一筆再呼叫模型） ----------
create index if not exists ai_calls_user_kind_at on public.ai_calls (user_id, kind, created_at desc);

-- ---------- 9. 計數器「加一」要是原子的（航班查詢的每月額度；多支手機同時查時不會少算） ----------
-- 回傳加完之後的數字；已經到上限就回 null、不加。
create or replace function public.bump_counter(p_key text, p_max integer) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.flight_cache (key, data, fetched_at) values (p_key, jsonb_build_object('n', 0), now())
    on conflict (key) do nothing;
  update public.flight_cache
    set data = jsonb_set(data, '{n}', to_jsonb(coalesce((data ->> 'n')::integer, 0) + 1)), fetched_at = now()
    where key = p_key and coalesce((data ->> 'n')::integer, 0) < p_max
    returning (data ->> 'n')::integer into n;
  return n;
end
$$;
revoke all on function public.bump_counter(text, integer) from public, anon, authenticated;
grant execute on function public.bump_counter(text, integer) to service_role;

-- ---------- 10. 小東西 ----------
-- 和 chat_messages_trip_user_idx（trip_id, user_id, created_at）重複
drop index if exists public.chat_messages_user_created;
