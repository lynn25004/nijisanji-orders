-- 在 Supabase Dashboard SQL Editor 執行一次
-- 給 orders 加入物流狀態 + 退款狀態欄位（從樂淘 API 帶入）

alter table orders add column if not exists warehouse_status text;  -- 例：「待發貨 / 已出倉 / 派送中 / 已簽收」
alter table orders add column if not exists refund_status int;       -- 樂淘 refundStatus (0=正常 / 其他=退款流程中)

create index if not exists idx_orders_warehouse_status on orders(warehouse_status);
