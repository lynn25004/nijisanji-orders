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

async function fetchWithRetry(url: string, token: string, attempts = 3): Promise<any> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, {
        headers: {
          "Authori-zation": token,
          Lang: "cht",
          platform: "web",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0"
        },
        cache: "no-store",
        signal: ctrl.signal
      });
      clearTimeout(t);
      return await res.json();
    } catch (e: any) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
      }
    }
  }
  throw new Error(`letao fetch failed after ${attempts} attempts: ${lastErr?.message || lastErr}`);
}

export async function fetchLetaoOrders(
  token: string,
  opts: { type?: number; page?: number; limit?: number } = {}
): Promise<{ total: number; list: LetaoOrder[]; raw: any }> {
  const { type = 8, page = 1, limit = 100 } = opts;
  const url = `${API_BASE}/api/front/order/list?type=${type}&page=${page}&limit=${limit}`;
  const body = await fetchWithRetry(url, token);
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
