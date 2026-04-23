export type Group = {
  id: string;
  name_ja: string;
  name_zh: string | null;
  sort_order: number;
};

export type Talent = {
  id: string;
  name_ja: string;
  name_zh: string | null;
  group_id: string | null;
};

export type Product = {
  id: string;
  shop_url: string | null;
  name_ja: string;
  name_zh: string | null;
  image_url: string | null;
  release_date: string | null;
  list_price_jpy: number | null;
};

export type Order = {
  id: string;
  proxy_service: string | null;
  proxy_order_no: string | null;
  ordered_at: string;
  status: string;
  total_jpy: number | null;
  proxy_fee_jpy: number;
  shipping_jpy: number;
  total_twd: number | null;
  exchange_rate: number | null;
  notes: string | null;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  qty: number;
  unit_price_jpy: number | null;
};
