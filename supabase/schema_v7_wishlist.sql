-- v7: 想買清單（wishlist）
-- 還沒下單但「之後想買」的商品；下單後可手動標記移走

create table if not exists wishlist (
  id uuid primary key default gen_random_uuid(),
  name_ja text not null,
  shop_product_code text,
  shop_url text,
  image_url text,
  release_date date,
  preorder_start date,
  notes text,
  -- 1=必買 / 2=想要 / 3=觀望
  priority smallint not null default 2,
  -- 關聯成員（可選；簡單起見直接存 talent_ids 陣列，不另開關聯表）
  talent_ids uuid[] default '{}',
  added_at timestamptz not null default now(),
  -- soft-delete：手動標記為已下單時填入 ordered_at
  ordered_at timestamptz
);

create index if not exists idx_wishlist_active on wishlist(ordered_at) where ordered_at is null;
create index if not exists idx_wishlist_release on wishlist(release_date);
create index if not exists idx_wishlist_priority on wishlist(priority);

-- 開放 anon 讀寫（與 orders/products 一致）
alter table wishlist disable row level security;
