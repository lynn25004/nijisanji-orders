// Parse shop.nijisanji.jp 訂單完成信
// 固定模板（信件主旨：【にじさんじオフィシャルストア】ご注文完了のお知らせ）

export type ParsedOrderItem = {
  shop_product_code: string | null; // 品番
  name_ja: string;
  qty: number;
  unit_price_jpy: number | null;
};

export type ParsedOrder = {
  order_no: string;                     // 注文番号
  ordered_at: Date;                     // 以信件收到日期為主
  total_jpy: number | null;             // ご請求額 or ご注文金額総合計
  payment_method: string | null;        // お支払い方法
  items: ParsedOrderItem[];
  raw_subject: string;
};

function toNumber(s: string): number | null {
  const n = parseInt(s.replace(/[,¥￥\s円]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&yen;/gi, "¥")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function normalize(text: string): string {
  // 若看起來是 HTML 就轉成 text
  const looksHtml = /<\/?(p|div|br|body|html)\b/i.test(text);
  let t = looksHtml ? htmlToText(text) : text;
  t = decodeEntities(t);
  return t
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\u3000/g, " ");
}

export function parseShopNijisanjiOrder(
  text: string,
  opts: { receivedAt: Date; subject: string }
): ParsedOrder | null {
  const body = normalize(text);

  // 注文番号 — 英數組合
  const orderNoMatch =
    body.match(/注文番号[:：\s]+([A-Za-z0-9\-]+)/) ||
    body.match(/ご注文番号[:：\s]+([A-Za-z0-9\-]+)/);
  if (!orderNoMatch) return null;
  const order_no = orderNoMatch[1].trim();

  // 總金額 — 優先 ご請求額，其次 ご注文金額総合計
  const totalMatch =
    body.match(/ご請求額[:：\s]+[¥￥]?\s*([0-9,]+)\s*円?/) ||
    body.match(/ご注文金額総合計[:：\s]+[¥￥]?\s*([0-9,]+)\s*円?/) ||
    body.match(/合計[:：\s]+[¥￥]?\s*([0-9,]+)\s*円?/);
  const total_jpy = totalMatch ? toNumber(totalMatch[1]) : null;

  // 付款方式
  const payMatch = body.match(/お支払い方法[:：\s]+([^\n]+)/);
  const payment_method = payMatch ? payMatch[1].trim().slice(0, 100) : null;

  // 商品 — 用「品番 / 商品名 / 個数 / 販売価格」一組一組抓
  // 格式常見兩種：1) 區塊式（每個商品一個 block）；2) 表格式
  const items: ParsedOrderItem[] = [];

  // 嘗試 block 解析：以「品番」為 anchor 切段（可接空白或冒號）
  const blocks = body.split(/(?=品番[:：\s])/g);
  for (const block of blocks) {
    const codeM = block.match(/品番[:：\s]+([^\s\n]+)/);
    if (!codeM) continue;
    const nameM = block.match(/商品名[:：\s]+([^\n]+)/);
    const qtyM = block.match(/個数[:：\s]+([0-9]+)/);
    const priceM = block.match(/販売価格[:：\s]+[¥￥]?\s*([0-9,]+)/);

    if (!nameM) continue;
    items.push({
      shop_product_code: codeM[1].trim() || null,
      name_ja: nameM[1].trim(),
      qty: qtyM ? parseInt(qtyM[1], 10) : 1,
      unit_price_jpy: priceM ? toNumber(priceM[1]) : null
    });
  }

  // fallback：若 block 解析失敗，至少塞一個「未命名商品」保留訂單
  if (items.length === 0) {
    items.push({
      shop_product_code: null,
      name_ja: opts.subject.replace(/【.*?】/g, "").trim() || "（未解析商品）",
      qty: 1,
      unit_price_jpy: total_jpy
    });
  }

  return {
    order_no,
    ordered_at: opts.receivedAt,
    total_jpy,
    payment_method,
    items,
    raw_subject: opts.subject
  };
}
