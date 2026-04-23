-- ============================================================
-- Nijisanji Orders — Supabase schema
-- 貼到 Supabase Dashboard -> SQL Editor -> Run
-- ============================================================

-- 啟用 uuid 產生器
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- groups: 團體（にじさんじ / NIJISANJI EN / ROF-MAO / Nornis ...）
-- ------------------------------------------------------------
create table if not exists groups (
  id           uuid primary key default uuid_generate_v4(),
  name_ja      text not null,
  name_zh      text,
  sort_order   int default 0,
  created_at   timestamptz default now()
);

-- 預灌幾個常見團體（自由增減）
insert into groups (name_ja, name_zh, sort_order) values
  ('にじさんじ',            'NIJISANJI 本家',      10),
  ('NIJISANJI EN',         'NIJISANJI EN',        20),
  ('NIJISANJI ID',         'NIJISANJI ID',        30),
  ('NIJISANJI KR',         'NIJISANJI KR（已畢業）',40),
  ('ROF-MAO',              'ROF-MAO',             50),
  ('Nornis',               'Nornis',              60),
  ('ChroNoiR',             'ChroNoiR',            70),
  ('Noctyx',               'Noctyx',              80),
  ('VOLTACTION',           'VOLTACTION',          90),
  ('XSOLEIL',              'XSOLEIL',            100),
  ('その他',               '其他 / 多團體聯名',  999)
on conflict do nothing;

-- ------------------------------------------------------------
-- talents: 藝人（VTuber）
-- ------------------------------------------------------------
create table if not exists talents (
  id           uuid primary key default uuid_generate_v4(),
  name_ja      text not null,
  name_zh      text,
  group_id     uuid references groups(id) on delete set null,
  created_at   timestamptz default now()
);

create index if not exists idx_talents_group on talents(group_id);

-- ------------------------------------------------------------
-- products: 商品（每個 shop.nijisanji.jp 商品唯一）
-- ------------------------------------------------------------
create table if not exists products (
  id              uuid primary key default uuid_generate_v4(),
  shop_url        text unique,                  -- 原始 shop.nijisanji.jp 連結
  name_ja         text not null,
  name_zh         text,
  image_url       text,
  release_date    date,                          -- 上架日
  list_price_jpy  int,                           -- 官方定價（日圓含稅）
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_products_release on products(release_date desc);

-- ------------------------------------------------------------
-- product_talents: 商品 ↔ 藝人（多對多；一個商品可含多位藝人）
-- ------------------------------------------------------------
create table if not exists product_talents (
  product_id   uuid references products(id) on delete cascade,
  talent_id    uuid references talents(id)  on delete cascade,
  primary key (product_id, talent_id)
);

-- ------------------------------------------------------------
-- orders: 代購訂單
-- ------------------------------------------------------------
create table if not exists orders (
  id                 uuid primary key default uuid_generate_v4(),
  proxy_service      text,                       -- 代購商名稱（Buyee、Tenso、樂一番...）
  proxy_order_no     text,                       -- 代購單號
  ordered_at         date not null default current_date,
  status             text default 'ordered',     -- ordered/paid/shipped/delivered/cancelled
  total_jpy          int,                        -- 商品總額（日圓）
  proxy_fee_jpy      int default 0,              -- 代購手續費（日圓）
  shipping_jpy       int default 0,              -- 國際運費（日圓）
  total_twd          int,                        -- 實付台幣
  exchange_rate      numeric(6,4),               -- 當時匯率（JPY → TWD）
  notes              text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists idx_orders_ordered_at on orders(ordered_at desc);

-- ------------------------------------------------------------
-- order_items: 訂單項目
-- ------------------------------------------------------------
create table if not exists order_items (
  id              uuid primary key default uuid_generate_v4(),
  order_id        uuid references orders(id)   on delete cascade,
  product_id      uuid references products(id) on delete restrict,
  qty             int  not null default 1,
  unit_price_jpy  int,                           -- 下單當下單價
  created_at      timestamptz default now()
);

create index if not exists idx_order_items_order   on order_items(order_id);
create index if not exists idx_order_items_product on order_items(product_id);

-- ------------------------------------------------------------
-- 自動更新 updated_at
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated
  before update on products
  for each row execute function set_updated_at();

drop trigger if exists trg_orders_updated on orders;
create trigger trg_orders_updated
  before update on orders
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- RLS：目前給自己用，全開（未來要多人再鎖）
-- ------------------------------------------------------------
alter table groups          disable row level security;
alter table talents         disable row level security;
alter table products        disable row level security;
alter table product_talents disable row level security;
alter table orders          disable row level security;
alter table order_items     disable row level security;

-- ------------------------------------------------------------
-- 常用查詢 view：訂單概覽
-- ------------------------------------------------------------
create or replace view v_orders_overview as
select
  o.id,
  o.ordered_at,
  o.proxy_service,
  o.proxy_order_no,
  o.status,
  o.total_twd,
  o.total_jpy,
  count(oi.id) as item_count,
  array_agg(distinct p.name_ja) as product_names
from orders o
left join order_items oi on oi.order_id = o.id
left join products p     on p.id = oi.product_id
group by o.id
order by o.ordered_at desc;
