-- Phase B 追加：source_email_id 防止重複匯入
alter table orders add column if not exists source_email_id text unique;
create index if not exists idx_orders_source_email on orders(source_email_id);

-- 追加 shop_product_code 讓 products 也能用品番去重（shop_url 未必存在）
alter table products add column if not exists shop_product_code text;
create unique index if not exists idx_products_code on products(shop_product_code) where shop_product_code is not null;
