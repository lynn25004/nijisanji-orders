// 抓 shop.nijisanji.jp 商品頁（SSR HTML，不用 JS）
// 商品 URL pattern: https://shop.nijisanji.jp/{code}.html
// 訂單品番常帶 SKU 後綴（dig-00065_KV_set1），shop 上對應的是 dig-00065_KV.html
// 策略：先載 sitemap，做「最長 prefix match」找對應的 parent 頁

import { supabaseServer } from "./supabase-server";

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
  `${BASE}/sitemap_1-product.xml`,
];

// 記憶體快取
let _sitemapCache: { codes: string[]; at: number } | null = null;
const SITEMAP_TTL_MS = 6 * 60 * 60 * 1000;

// 群組成員快取（unit name -> 成員 name_ja[]）
let _groupMembersCache: { map: Map<string, string[]>; at: number } | null = null;
const GROUP_TTL_MS = 30 * 60 * 1000; // 30 分鐘

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
    redirect: "follow",
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

// 載入 groups + 成員 map：把 unit/group name (含羅馬字) 映射到 talent name_ja 列表
async function loadGroupMembers(): Promise<Map<string, string[]>> {
  if (_groupMembersCache && Date.now() - _groupMembersCache.at < GROUP_TTL_MS) {
    return _groupMembersCache.map;
  }
  const map = new Map<string, string[]>();
  try {
    const sb = supabaseServer();
    // groups 有 name_ja / name_en / aliases；talents 有 group_id / name_ja
    const { data: groups } = await sb
      .from("groups")
      .select("id, name_ja, name_en, aliases");
    const { data: talents } = await sb
      .from("talents")
      .select("name_ja, group_id");

    if (groups && talents) {
      const byGroup = new Map<string, string[]>();
      for (const t of talents) {
        if (!t.group_id || !t.name_ja) continue;
        const arr = byGroup.get(t.group_id) || [];
        arr.push(t.name_ja);
        byGroup.set(t.group_id, arr);
      }
      for (const g of groups) {
        const members = byGroup.get(g.id) || [];
        if (members.length === 0) continue;
        const keys = new Set<string>();
        if (g.name_ja) keys.add(g.name_ja);
        if (g.name_en) keys.add(g.name_en);
        if (Array.isArray(g.aliases)) {
          for (const a of g.aliases) if (a) keys.add(a);
        }
        for (const k of keys) {
          map.set(k.toLowerCase(), members);
        }
      }
    }
  } catch (e) {
    console.warn("[scrape] loadGroupMembers failed:", e);
  }
  _groupMembersCache = { map, at: Date.now() };
  return map;
}

function findBestMatch(query: string, sitemapCodes: string[]): string | null {
  let best: string | null = null;
  for (const code of sitemapCodes) {
    if (code === query || query.startsWith(code + "_") || query.startsWith(code)) {
      if (query.length - code.length > 15) continue;
      if (!best || code.length > best.length) best = code;
    }
  }
  return best;
}

// 從 ライバー 區塊抓 <a href="/數字">名字</a>
function extractTalentsFromLiverSection(html: string): string[] {
  const names = new Set<string>();
  // 找所有「ライバー」標題後面的 <ul> 或下一段
  const headerRe = /ライバー\s*<\/[A-Za-z0-9]+>/g;
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(html))) {
    const segment = html.substring(hm.index, hm.index + 5000);
    // 找 link-list-liver 容器（更精準）
    const containerMatch = segment.match(
      /<ul[^>]*link-list-liver[^>]*>([\s\S]*?)<\/ul>/
    );
    const target = containerMatch ? containerMatch[1] : segment;
    const aRe = /<a[^>]+href=["']\/(\d{3,5})["'][^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = aRe.exec(target))) {
      // 名字裡可能含 <span>，剝掉所有 tag
      const raw = m[2].replace(/<[^>]+>/g, "");
      const name = decode(raw).trim();
      if (name && name.length <= 40) names.add(name);
    }
  }
  return Array.from(names);
}

// 從變體選單抓（On-Deck! 那種有多人特典的多變體商品）
function extractTalentsFromVariations(html: string): string[] {
  const names = new Set<string>();
  // <span class="button-select-title">伊波ライ</span>
  const re = /<span[^>]+button-select-title[^>]*>([^<]+)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = decode(m[1]).trim();
    if (name && name.length <= 40) names.add(name);
  }
  return Array.from(names);
}

// 從關連標籤抓 unit/group 名（＃ROF-MAO、＃Nornis 等）
function extractUnitTags(html: string): string[] {
  const tags = new Set<string>();
  // <a href="/TAG_xxx" class="tag">＃ROF-MAO</a>
  const re = /<a[^>]+href=["']\/TAG_\d+["'][^>]*>([^<]+)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = decode(m[1]).trim();
    // 去掉開頭的 ＃ / # 符號
    const tag = raw.replace(/^[＃#]+/, "").trim();
    if (tag && tag.length <= 30) tags.add(tag);
  }
  return Array.from(tags);
}

// 把 unit tag 展開成成員列表
function expandUnits(tags: string[], groupMap: Map<string, string[]>): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    const members = groupMap.get(tag.toLowerCase());
    if (members) {
      for (const m of members) out.add(m);
    }
  }
  return Array.from(out);
}

function isPageRelevant(scraped: ScrapedProduct, orderName: string | null): boolean {
  if (!orderName) return true;
  if (scraped.talents_ja.length === 0) return true;
  return scraped.talents_ja.some((t) => orderName.includes(t));
}

function allCandidates(query: string): string[] {
  const out = [query];
  let cur = query;
  while (cur.includes("_")) {
    cur = cur.substring(0, cur.lastIndexOf("_"));
    out.push(cur);
  }
  return out;
}

export async function scrapeShopProduct(
  shopProductCode: string,
  orderName?: string | null
): Promise<ScrapedProduct | null> {
  const [sitemap, groupMap] = await Promise.all([
    loadSitemapCodes(),
    loadGroupMembers(),
  ]);

  const best = findBestMatch(shopProductCode, sitemap);
  const tryList: { code: string; fromSitemap: boolean }[] = best
    ? [
        { code: best, fromSitemap: true },
        ...allCandidates(shopProductCode)
          .filter((c) => c !== best)
          .map((code) => ({ code, fromSitemap: false })),
      ]
    : allCandidates(shopProductCode).map((code) => ({ code, fromSitemap: false }));

  for (const { code, fromSitemap } of tryList) {
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

      // 三路抓取 → 合併
      const fromLiver = extractTalentsFromLiverSection(html);
      const fromVariations = extractTalentsFromVariations(html);
      const unitTags = extractUnitTags(html);
      const fromUnits = expandUnits(unitTags, groupMap);

      const merged = new Set<string>([
        ...fromLiver,
        ...fromVariations,
        ...fromUnits,
      ]);

      const scraped: ScrapedProduct = {
        url,
        title_ja: title,
        image_url: ogImage,
        description: ogDesc,
        talents_ja: Array.from(merged),
      };

      if (
        code === shopProductCode ||
        fromSitemap ||
        isPageRelevant(scraped, orderName ?? null)
      ) {
        if (process.env.NODE_ENV !== "production") {
          console.log(
            `[scrape] ${code}: liver=${fromLiver.length} var=${fromVariations.length} units=${unitTags.join(",")} expanded=${fromUnits.length} merged=${merged.size}`
          );
        }
        return scraped;
      }
    } catch {
      continue;
    }
  }
  return null;
}
