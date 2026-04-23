// 抓 shop.nijisanji.jp 商品頁（SSR HTML，不用 JS）
// 商品 URL pattern: https://shop.nijisanji.jp/{code}.html
// 訂單品番常帶 SKU 後綴（dig-00065_KV_set1），shop 上對應的是 dig-00065_KV.html
// 策略：先載 sitemap，做「最長 prefix match」找對應的 parent 頁

export type ScrapedProduct = {
  url: string;
  title_ja: string;
  image_url: string | null;
  description: string | null;
  talents_ja: string[];
};

const BASE = "https://shop.nijisanji.jp";
const UA =
  "Mozilla/5.0 (compatible; nijisanji-orders-bot/1.0; +https://nijisanji-orders.vercel.app)";

const SITEMAP_URLS = [
  `${BASE}/sitemap_0-product.xml`,
  `${BASE}/sitemap_1-product.xml`
];

// 記憶體快取 sitemap（同一個 serverless 實例會 reuse）
let _sitemapCache: { codes: string[]; at: number } | null = null;
const SITEMAP_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

function matchMeta(html: string, prop: string): string | null {
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    "i"
  );
  const m = html.match(re1) || html.match(re2);
  return m ? decode(m[1]) : null;
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ja" },
    redirect: "follow"
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function loadSitemapCodes(): Promise<string[]> {
  if (_sitemapCache && Date.now() - _sitemapCache.at < SITEMAP_TTL_MS) {
    return _sitemapCache.codes;
  }
  const codes = new Set<string>();
  for (const sm of SITEMAP_URLS) {
    try {
      const { status, text } = await fetchText(sm);
      if (status !== 200) continue;
      const re = /https:\/\/shop\.nijisanji\.jp\/([^<\s]+)\.html/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) codes.add(m[1]);
    } catch {
      /* ignore */
    }
  }
  const arr = Array.from(codes);
  _sitemapCache = { codes: arr, at: Date.now() };
  return arr;
}

// 最長 prefix match：在 sitemap 中找「是 query prefix 且最長」的 code
// 也允許完全相等（這是最理想的情況）
function findBestMatch(query: string, sitemapCodes: string[]): string | null {
  let best: string | null = null;
  for (const code of sitemapCodes) {
    if (code === query || query.startsWith(code + "_") || query.startsWith(code)) {
      // 只要 code 是 query 的前綴（或完全相等）
      // 防止誤配：code 不能比 query 短太多（差 >= 15 字元可能是錯配）
      if (query.length - code.length > 15) continue;
      if (!best || code.length > best.length) best = code;
    }
  }
  return best;
}

function extractTalents(html: string): string[] {
  const idx = html.search(/ライバー<\/[A-Za-z0-9]+>/);
  if (idx < 0) return [];
  const segment = html.substring(idx, idx + 3000);
  const names = new Set<string>();
  const re = /<a[^>]+href=["']\/\d{3,5}["'][^>]*>([^<]+)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) {
    const name = decode(m[1]).trim();
    if (name && name.length <= 40) names.add(name);
  }
  return Array.from(names);
}

// 產生候選 code 列表：完整 → 逐步 strip 一個 _xxx 後綴
// 下限：第一個 _ 前的基礎 ID（如 dig-00065）
function allCandidates(query: string): string[] {
  const out = [query];
  let cur = query;
  while (cur.includes("_")) {
    cur = cur.substring(0, cur.lastIndexOf("_"));
    out.push(cur);
  }
  return out;
}

// Sanity check：scraped 頁面的 liver 名字是否出現在訂單商品名裡
// 這可以避開「dig-00077_KV_set1 → dig-00077」這種 ID 相同但商品不同的誤配
function isPageRelevant(scraped: ScrapedProduct, orderName: string | null): boolean {
  if (!orderName) return true; // 無參考資料就信任
  if (scraped.talents_ja.length === 0) return true; // 沒抓到藝人就信任（可能商品頁格式不同）
  // 只要有一個 scraped liver 名字出現在訂單名就算相關
  return scraped.talents_ja.some((t) => orderName.includes(t));
}

export async function scrapeShopProduct(
  shopProductCode: string,
  orderName?: string | null
): Promise<ScrapedProduct | null> {
  const sitemap = await loadSitemapCodes();

  // 先用 sitemap 挑最長 prefix match；若 404 再試其他候選
  const best = findBestMatch(shopProductCode, sitemap);
  const tryList = best
    ? [best, ...allCandidates(shopProductCode).filter((c) => c !== best)]
    : allCandidates(shopProductCode);

  for (const code of tryList) {
    const url = `${BASE}/${code}.html`;
    try {
      const { status, text: html } = await fetchText(url);
      if (status !== 200) continue;
      if (
        html.includes("ご指定のページが見つかりません") ||
        html.includes("ページが見つかりませんでした")
      )
        continue;

      const ogTitle =
        matchMeta(html, "og:title") || matchMeta(html, "title") || "";
      const ogImage = matchMeta(html, "og:image");
      const ogDesc = matchMeta(html, "og:description");
      const title = ogTitle.replace(/｜にじさんじオフィシャルストア$/, "").trim();
      if (!title) continue;

      const scraped: ScrapedProduct = {
        url,
        title_ja: title,
        image_url: ogImage,
        description: ogDesc,
        talents_ja: extractTalents(html)
      };

      // 精確 code 直接接受；否則要通過 liver 一致性檢查
      if (code === shopProductCode || isPageRelevant(scraped, orderName ?? null)) {
        return scraped;
      }
    } catch {
      continue;
    }
  }
  return null;
}
