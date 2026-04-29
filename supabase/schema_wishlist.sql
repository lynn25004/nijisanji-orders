-- 願望單（wishlist）：還沒下單但想買的商品
-- 含「下單後自動移出 wishlist」trigger
-- 全部 idempotent

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
  -- 關聯成員（可選；簡單起見直接存 talent_ids 陣列）
  talent_ids uuid[] default '{}',
  added_at timestamptz not null default now(),
  -- soft-delete：下單後填入
  ordered_at timestamptz
);

create index if not exists idx_wishlist_active   on wishlist(ordered_at) where ordered_at is null;
create index if not exists idx_wishlist_release  on wishlist(release_date);
create index if not exists idx_wishlist_priority on wishlist(priority);

alter table wishlist disable row level security;

-- 任何 cron 把新 product 寫入 products 時，
-- 若 wishlist 同 shop_product_code 還沒下單，自動標記為已下單
create or replace function auto_remove_from_wishlist()
returns trigger as $$
begin
  if NEW.shop_product_code is not null then
    update wishlist
       set ordered_at = now()
     where ordered_at is null
       and shop_product_code = NEW.shop_product_code;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_wishlist_autoremove on products;
create trigger trg_wishlist_autoremove
after insert on products
for each row execute function auto_remove_from_wishlist();
