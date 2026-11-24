-- 卡片庫的英文：每張卡多一欄 en（jsonb，中文句子 → 英文），放說明、條件、上限那些句子的英文。
-- 英文畫面查這份對照，查不到就顯示中文。內容由 translate-card 這支函式在有人存檔後自動補（用 service role 寫）。
alter table public.card_catalog add column if not exists en jsonb not null default '{}'::jsonb;
alter table public.card_catalog drop constraint if exists card_catalog_en_object;
alter table public.card_catalog add constraint card_catalog_en_object check (jsonb_typeof(en) = 'object');
