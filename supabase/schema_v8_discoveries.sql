-- v8: 自動偵測 shop.nijisanji.jp 上架商品
-- 每天 cron 抓 /M01 列表，把新品存進來，比對使用者過去買過的成員，
-- 命中就 Telegram 提醒「你常買的 X 出新品了」

create table if not exists discovered_products (
  id uuid primary key default gen_random_uuid(),
  shop_product_code text unique not null,
  shop_url text,
  name_ja text not null,
  image_url text,
  price_jpy integer,
  -- 從商品名稱比對 talents.name_ja 抓出來的成員 id
  talent_ids uuid[] default '{}',
  -- 是否已有人下單（與 products.shop_product_code 對得上）
  has_order boolean default false,
  discovered_at timestamptz not null default now(),
  -- 推過 Telegram 就填，避免重複推
  notified_at timestamptz
);

create index if not exists idx_discovered_recent on discovered_products(discovered_at desc);
create index if not exists idx_discovered_pending on discovered_products(notified_at) where notified_at is null;

alter table discovered_products disable row level security;
