-- Phase D：匯入 moegirl 彩虹社日本分部全員表 + 自動辨識
-- 執行方式：Supabase Dashboard → SQL Editor → 貼上 → Run

alter table talents add column if not exists name_en text;
alter table talents add column if not exists aliases text[];
alter table groups  add column if not exists kind text;      -- 'batch' | 'unit' | 'branch'
alter table groups  add column if not exists name_en text;

create index if not exists idx_talents_name_ja_g on talents(name_ja);

-- 記 auto-tag 用的快取欄位，供 cron 判斷是否已跑過
alter table products add column if not exists auto_tagged_at timestamptz;
create index if not exists idx_products_auto_tagged on products(auto_tagged_at);
