import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SHOP_BASE = "https://shop.nijisanji.jp";
const SOFT_DEADLINE_MS = 25_000;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

type ParsedCard = {
  code: string;
  url: string;
  name: string;
  image: string | null;
  price: number | null;
};

function parseCards(html: string): ParsedCard[] {
  const out: ParsedCard[] = [];
  const re =
    /<div\s+class="card-container"\s+data-pid="([^"]+)"[\s\S]*?<a\s+class="card"\s+href="([^"]+)"[\s\S]*?<img\s+src="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?(?:&yen;([\d,]+))?[\s\S]*?<\/div>\s*<\/a>\s*<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const code = m[1].trim();
    const href = m[2].trim();
    const img = m[3].trim();
    const alt = decodeEntities(m[4].trim());
    const price = m[5] ? parseInt(m[5].replace(/,/g, ""), 10) : null;
    if (!code || !alt) continue;
    out.push({
      code,
      url: href.startsWith("http") ? href : `${SHOP_BASE}${href}`,
      name: alt,
      image: img.startsWith("http") ? img : `${SHOP_BASE}${img}`,
      price
    });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/&yen;/g, "¥");
}

async function fetchSearch(q: string): Promise<string> {
  const url = `${SHOP_BASE}/search?q=${encodeURIComponent(q)}&start=0&sz=24`;
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "ja"
    },
    cache: "no-store"
  });
  if (!r.ok) throw new Error(`shop search "${q}" failed: ${r.status}`);
  return r.text();
}

async function fetchPage(start: number): Promise<string> {
  const url =
    start === 0
      ? `${SHOP_BASE}/M01`
      : `${SHOP_BASE}/searchUpdateGrid?cgid=M01&pageNo=${
          Math.floor(start / 88) + 1
        }&prefn1=endOfSale&prefv1=%E8%B2%A9%E5%A3%B2%E4%B8%AD&start=${start}&sz=12`;
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "ja"
    },
    cache: "no-store"
  });
  if (!r.ok) throw new Error(`shop fetch ${start} failed: ${r.status}`);
  return r.text();
}

export async function GET(req: NextRequest) {
  const start = Date.now();
  const secret = process.env.CRON_SECRET;
  const header =
    req.headers.get("authorization") || req.headers.get("x-cron-secret") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const qs = req.nextUrl.searchParams.get("secret") || "";
  if (!secret || (token !== secret && qs !== secret)) return unauthorized();

  const sb = supabaseServer();

  // 1. 抓 talents（給名稱比對用）
  const { data: talents } = await sb
    .from("talents")
    .select("id, name_ja, name_en, group_id");
  const talentMatchers: Array<{ id: string; needles: string[] }> = (
    talents || []
  )
    .map((t) => {
      const needles: string[] = [];
      if (t.name_ja && t.name_ja.length >= 2) needles.push(t.name_ja);
      // 用中點拆主名/姓名
      if (t.name_ja) {
        const parts = t.name_ja
          .split(/[・·•]/)
          .map((s: string) => s.trim())
          .filter((s: string) => s.length >= 2);
        if (parts.length > 1) needles.push(...parts);
      }
      return { id: t.id, needles: Array.from(new Set(needles)) };
    })
    .filter((x) => x.needles.length > 0);

  // 2. 抓「使用者買過誰」當訂閱清單
  const { data: ownedRows } = await sb
    .from("product_talents")
    .select("talent_id");
  const subscribed = new Set<string>(
    (ownedRows || []).map((r: any) => r.talent_id)
  );

  // 1b. 建 group → 成員 map（用於商品名只寫團名時展開）
  // 黑名單：太通用的 group 名（避免「にじさんじ」當關鍵字爆炸命中）
  const GROUP_BLACKLIST = new Set([
    "にじさんじ",
    "NIJISANJI EN",
    "NIJISANJI ID",
    "NIJISANJI KR",
    "その他",
    "二期生",
    "一期生"
  ]);
  const { data: groups } = await sb.from("groups").select("id, name_ja");
  const groupMatchers: Array<{ name: string; talentIds: string[] }> = [];
  for (const g of groups || []) {
    if (!g.name_ja || g.name_ja.length < 3) continue;
    if (GROUP_BLACKLIST.has(g.name_ja)) continue;
    const members = (talents || [])
      .filter((t: any) => t.group_id === g.id)
      .map((t: any) => t.id);
    if (members.length === 0) continue;
    groupMatchers.push({ name: g.name_ja, talentIds: members });
  }

  // 3. 抓 shop 前 3 頁
  const allCards: ParsedCard[] = [];
  for (const startIdx of [0, 88, 100]) {
    if (Date.now() - start > SOFT_DEADLINE_MS) break;
    try {
      const html = await fetchPage(startIdx);
      allCards.push(...parseCards(html));
    } catch (e: any) {
      // 容錯：第一頁失敗才中止
      if (startIdx === 0) throw e;
    }
  }

  // 3b. 抓搜尋紀錄關鍵字（最近 30 天搜過 ≥ 2 次的）
  const keywordHits = new Map<string, string[]>(); // code -> [matched queries]
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: queries } = await sb
    .from("search_history")
    .select("query")
    .gte("last_searched_at", cutoff)
    .gte("hit_count", 2)
    .order("last_searched_at", { ascending: false })
    .limit(10);

  for (const row of (queries || []) as Array<{ query: string }>) {
    if (Date.now() - start > SOFT_DEADLINE_MS) break;
    try {
      const html = await fetchSearch(row.query);
      const found = parseCards(html);
      for (const c of found) {
        allCards.push(c);
        const arr = keywordHits.get(c.code) || [];
        if (!arr.includes(row.query)) arr.push(row.query);
        keywordHits.set(c.code, arr);
      }
    } catch {
      // 單個關鍵字失敗不影響整體
    }
  }

  // 去重
  const dedup = new Map<string, ParsedCard>();
  for (const c of allCards) if (!dedup.has(c.code)) dedup.set(c.code, c);
  const cards = Array.from(dedup.values());

  if (cards.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { fetched: 0, inserted: 0, notified: 0 },
      reason: "no cards parsed"
    });
  }

  // 4. 查既有的 discovered_products
  const codes = cards.map((c) => c.code);
  const { data: existingDisc } = await sb
    .from("discovered_products")
    .select("shop_product_code")
    .in("shop_product_code", codes);
  const existingSet = new Set<string>(
    (existingDisc || []).map((r: any) => r.shop_product_code)
  );

  // 4b. 查 products 是否已經有人下單（has_order）
  const { data: existingProd } = await sb
    .from("products")
    .select("shop_product_code")
    .in("shop_product_code", codes);
  const orderedSet = new Set<string>(
    (existingProd || []).map((r: any) => r.shop_product_code)
  );

  // 5. 新品才寫入
  const newCards = cards.filter((c) => !existingSet.has(c.code));
  const subscribedHits: Array<{
    card: ParsedCard;
    talentIds: string[];
  }> = [];
  const keywordOnlyHits: Array<{
    card: ParsedCard;
    queries: string[];
  }> = [];

  for (const c of newCards) {
    const talentIdSet = new Set<string>();
    for (const t of talentMatchers) {
      if (t.needles.some((n) => c.name.includes(n))) talentIdSet.add(t.id);
    }
    // 商品名只寫團名（如「【Dytica 3rd】xxx」）→ 展開到該團全員
    if (talentIdSet.size === 0) {
      for (const g of groupMatchers) {
        if (c.name.includes(g.name)) {
          for (const id of g.talentIds) talentIdSet.add(id);
        }
      }
    }
    const talentIds = Array.from(talentIdSet);
    const matchSubscribed = talentIds.some((id) => subscribed.has(id));
    const matchedQueries = keywordHits.get(c.code) || [];

    await sb.from("discovered_products").insert({
      shop_product_code: c.code,
      shop_url: c.url,
      name_ja: c.name,
      image_url: c.image,
      price_jpy: c.price,
      talent_ids: talentIds,
      has_order: orderedSet.has(c.code)
    });

    if (matchSubscribed) {
      subscribedHits.push({ card: c, talentIds });
    } else if (matchedQueries.length > 0) {
      keywordOnlyHits.push({ card: c, queries: matchedQueries });
    }
  }

  // 6. 推 Telegram（只推訂閱命中、且尚未推過的）
  let notified = 0;
  if (subscribedHits.length > 0) {
    const talentNameMap = new Map<string, string>();
    (talents || []).forEach((t: any) =>
      talentNameMap.set(t.id, t.name_ja || t.name_en || "?")
    );

    const lines = subscribedHits.slice(0, 8).map(({ card, talentIds }) => {
      const names = talentIds
        .map((id) => talentNameMap.get(id))
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");
      const price = card.price ? ` ¥${card.price.toLocaleString()}` : "";
      return `• <a href="${card.url}">${escapeHtml(
        card.name
      )}</a>${price}\n  推：${escapeHtml(names)}`;
    });
    const more =
      subscribedHits.length > 8
        ? `\n…還有 ${subscribedHits.length - 8} 筆`
        : "";
    await notify(
      `🆕 <b>shop.nijisanji.jp 新品（你的成員）</b>\n${lines.join(
        "\n"
      )}${more}\nhttps://nijisanji-orders.vercel.app/discoveries`
    );

    // 標記已推
    const hitCodes = subscribedHits.map((h) => h.card.code);
    await sb
      .from("discovered_products")
      .update({ notified_at: new Date().toISOString() })
      .in("shop_product_code", hitCodes);
    notified = subscribedHits.length;
  }

  // 6b. 推 Telegram（關鍵字命中、且不是訂閱命中）
  if (keywordOnlyHits.length > 0) {
    const lines = keywordOnlyHits.slice(0, 8).map(({ card, queries }) => {
      const price = card.price ? ` ¥${card.price.toLocaleString()}` : "";
      return `• <a href="${card.url}">${escapeHtml(card.name)}</a>${price}\n  詞：${escapeHtml(queries.join(", "))}`;
    });
    const more =
      keywordOnlyHits.length > 8
        ? `\n…還有 ${keywordOnlyHits.length - 8} 筆`
        : "";
    await notify(
      `🔍 <b>shop.nijisanji.jp 新品（你的搜尋詞）</b>\n${lines.join("\n")}${more}\nhttps://nijisanji-orders.vercel.app/discoveries`
    );
    const hitCodes = keywordOnlyHits.map((h) => h.card.code);
    await sb
      .from("discovered_products")
      .update({ notified_at: new Date().toISOString() })
      .in("shop_product_code", hitCodes);
    notified += keywordOnlyHits.length;
  }

  return NextResponse.json({
    ok: true,
    summary: {
      fetched: cards.length,
      inserted: newCards.length,
      subscribed_hits: subscribedHits.length,
      keyword_hits: keywordOnlyHits.length,
      notified,
      elapsed_ms: Date.now() - start
    }
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
