-- v6: 加上熱點欄位 index（讓 .in() / .eq() 不會 seq scan）
-- 安全可重跑：全部 IF NOT EXISTS

-- orders.source_email_id：sync-letao 批次 .in() 撈現有訂單
create index if not exists idx_orders_source_email_id on orders(source_email_id);

-- products.shop_product_code：sync-letao / enrich-products 批次 .in() 撈商品
create index if not exists idx_products_shop_product_code on products(shop_product_code);

-- talents.name_ja：enrich-products / auto-tag 批次 .in() 撈藝人
create index if not exists idx_talents_name_ja on talents(name_ja);

-- product_talents 關聯：列表頁聯表 + onConflict upsert 用
create unique index if not exists uq_product_talents on product_talents(product_id, talent_id);
create index if not exists idx_product_talents_talent on product_talents(talent_id);

-- order_items：首頁聯表 orders + products
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_order_items_product on order_items(product_id);

-- talents.group_id：成員頁依團體分類
create index if not exists idx_talents_group on talents(group_id);
