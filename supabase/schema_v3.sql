-- Phase C 追加：是否已收到商品
alter table orders add column if not exists received_at date;
create index if not exists idx_orders_received_at on orders(received_at);
