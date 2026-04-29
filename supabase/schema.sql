-- ============================================================
-- Nijisanji Orders — 主 schema（fresh install 一鍵建庫）
-- 已整合舊 v1~v6 全部 alter / index
-- 全部 idempotent，重跑安全
-- ============================================================

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- groups: 團體（にじさんじ / NIJISANJI EN / ROF-MAO / Nornis ...）
-- ------------------------------------------------------------
create table if not exists groups (
  id           uuid primary key default uuid_generate_v4(),
  name_ja      text not null,
  name_zh      text,
  name_en      text,
  kind         text,                       -- 'batch' | 'unit' | 'branch'
  sort_order   int default 0,
  created_at   timestamptz default now()
);

alter table groups add column if not exists name_en text;
alter table groups add column if not exists kind text;

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
  name_en      text,
  aliases      text[],
  group_id     uuid references groups(id) on delete set null,
  debut_at     timestamptz,
  image_url    text,
  slug         text,
  created_at   timestamptz default now()
);

alter table talents add column if not exists name_en text;
alter table talents add column if not exists aliases text[];
alter table talents add column if not exists debut_at timestamptz;
alter table talents add column if not exists image_url text;
alter table talents add column if not exists slug text;

create index if not exists idx_talents_group on talents(group_id);
create index if not exists idx_talents_name_ja on talents(name_ja);
create index if not exists idx_talents_debut_at on talents(debut_at);
create index if not exists idx_talents_slug on talents(slug);

-- ------------------------------------------------------------
-- products: 商品（每個 shop.nijisanji.jp 商品唯一）
-- ------------------------------------------------------------
create table if not exists products (
  id                 uuid primary key default uuid_generate_v4(),
  shop_url           text unique,
  shop_product_code  text,
  name_ja            text not null,
  name_zh            text,
  image_url          text,
  release_date       date,
  list_price_jpy     int,
  auto_tagged_at     timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table products add column if not exists shop_product_code text;
alter table products add column if not exists auto_tagged_at timestamptz;

create index if not exists idx_products_release on products(release_date desc);
create unique index if not exists idx_products_code on products(shop_product_code) where shop_product_code is not null;
create index if not exists idx_products_shop_product_code on products(shop_product_code);
create index if not exists idx_products_auto_tagged on products(auto_tagged_at);

-- ------------------------------------------------------------
-- product_talents: 商品 ↔ 藝人（多對多）
-- ------------------------------------------------------------
create table if not exists product_talents (
  product_id   uuid references products(id) on delete cascade,
  talent_id    uuid references talents(id)  on delete cascade,
  primary key (product_id, talent_id)
);

create unique index if not exists uq_product_talents on product_talents(product_id, talent_id);
create index if not exists idx_product_talents_talent on product_talents(talent_id);

-- ------------------------------------------------------------
-- orders: 代購訂單
-- ------------------------------------------------------------
create table if not exists orders (
  id                 uuid primary key default uuid_generate_v4(),
  proxy_service      text,
  proxy_order_no     text,
  source_email_id    text unique,                 -- 防重複匯入
  ordered_at         date not null default current_date,
  received_at        date,                        -- 已收到商品的日期
  status             text default 'ordered',      -- ordered/paid/shipped/delivered/cancelled
  total_jpy          int,
  proxy_fee_jpy      int default 0,
  shipping_jpy       int default 0,
  total_twd          int,
  exchange_rate      numeric(6,4),
  notes              text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table orders add column if not exists source_email_id text;
alter table orders add column if not exists received_at date;

create index if not exists idx_orders_ordered_at on orders(ordered_at desc);
create index if not exists idx_orders_source_email on orders(source_email_id);
create index if not exists idx_orders_source_email_id on orders(source_email_id);
create index if not exists idx_orders_received_at on orders(received_at);

-- ------------------------------------------------------------
-- order_items: 訂單項目
-- ------------------------------------------------------------
create table if not exists order_items (
  id              uuid primary key default uuid_generate_v4(),
  order_id        uuid references orders(id)   on delete cascade,
  product_id      uuid references products(id) on delete restrict,
  qty             int  not null default 1,
  unit_price_jpy  int,
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
-- RLS：自己用，全關
-- ------------------------------------------------------------
alter table groups          disable row level security;
alter table talents         disable row level security;
alter table products        disable row level security;
alter table product_talents disable row level security;
alter table orders          disable row level security;
alter table order_items     disable row level security;

-- ------------------------------------------------------------
-- 訂單概覽 view
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
