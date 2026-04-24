const API_BASE = "https://api.letaofun.com";

export type LetaoItem = {
  externalProductId: string | null;
  storeName: string;
  image: string | null;
  price: string | null;
  cartNum: number;
  currency: string | null;
  agencyPurchaseMessage: string | null;
  warehousePackagesStatus: number | null;
  warehousePackagesStatusDesc: string | null;
};

export type LetaoOrder = {
  id: number;
  orderId: string;
  createTime: string; // "2026-04-22 23:11:47"
  payPrice: string;
  payPostage: string;
  currency: string;
  originSite: string;
  orderStatus: string;
  totalNum: number;
  refundStatus: number;
  orderInfoList: LetaoItem[];
};

export async function fetchLetaoOrders(
  token: string,
  opts: { type?: number; page?: number; limit?: number } = {}
): Promise<{ total: number; list: LetaoOrder[]; raw: any }> {
  const { type = 8, page = 1, limit = 100 } = opts;
  const url = `${API_BASE}/api/front/order/list?type=${type}&page=${page}&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      "Authori-zation": token,
      Lang: "cht",
      platform: "web",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    cache: "no-store"
  });
  const body = await res.json();
  if (body?.code !== 200) {
    throw new Error(`letao api code=${body?.code} msg=${body?.msg || "unknown"}`);
  }
  const data = body.data || {};
  return {
    total: data.total ?? 0,
    list: (data.list || data.records || []) as LetaoOrder[],
    raw: body
  };
}
