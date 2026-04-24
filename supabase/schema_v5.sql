-- Phase E：talents 加出道日期 + 官方圖片，供 /talents 頁面
-- 執行方式：Supabase Dashboard → SQL Editor → 貼上 → Run

alter table talents add column if not exists debut_at timestamptz;
alter table talents add column if not exists image_url text;
alter table talents add column if not exists slug text;
create index if not exists idx_talents_debut_at on talents(debut_at);
create index if not exists idx_talents_slug on talents(slug);
