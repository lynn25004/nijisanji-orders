import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { scrapeShopProduct } from "@/lib/scrape-shop-product";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header =
    req.headers.get("authorization") || req.headers.get("x-cron-secret") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const qs = req.nextUrl.searchParams.get("secret") || "";
  if (!secret || (token !== secret && qs !== secret)) return unauthorized();

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "5", 10);
  // force=1: 全部商品都重抓（含已 enrich 過的）
  // mode=undertagged: 抓「成員數 < min_talents」的商品，補齊缺成員的
  const force = req.nextUrl.searchParams.get("force") === "1";
  const mode = req.nextUrl.searchParams.get("mode") || ""; // "" | "undertagged"
  const minTalents = parseInt(
    req.nextUrl.searchParams.get("min_talents") || "2",
    10
  );

  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = 25_000;

  const sb = supabaseServer();

  // 三種挑商品的方式
  let candidateIds: string[] | null = null;

  if (mode === "undertagged") {
    // 找有 shop_product_code 但 talent count < minTalents 的商品（最舊的優先）
    const { data: under } = await sb.rpc("products_under_tagged", {
      min_talents: minTalents,
      max_rows: limit,
    });
    if (under && Array.isArray(under)) {
      candidateIds = under.map((r: any) => r.id);
    } else {
      // 如果 RPC 不存在，fallback 用兩段 SQL
      const { data: links } = await sb
        .from("product_talents")
        .select("product_id, talent_id");
      const counts = new Map<string, number>();
      for (const l of links ?? []) {
        counts.set(l.product_id, (counts.get(l.product_id) ?? 0) + 1);
      }
      const { data: prods } = await sb
        .from("products")
        .select("id, shop_product_code, created_at")
        .not("shop_product_code", "is", null)
        .order("created_at", { ascending: true });
      const filtered = (prods ?? []).filter(
        (p) => (counts.get(p.id) ?? 0) < minTalents
      );
      candidateIds = filtered.slice(0, limit).map((p) => p.id);
    }
  }

  let q = sb
    .from("products")
    .select("id, shop_product_code, name_ja, image_url, created_at")
    .not("shop_product_code", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (candidateIds && candidateIds.length) {
    q = q.in("id", candidateIds);
  } else if (!force) {
    q = q.is("image_url", null);
  }

  const { data: products, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: any[] = [];

  for (const p of products ?? []) {
    if (!p.shop_product_code) continue;
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      results.push({
        id: p.id,
        code: p.shop_product_code,
        status: "skipped_deadline",
      });
      continue;
    }
    try {
      const scraped = await scrapeShopProduct(p.shop_product_code, p.name_ja);
      if (!scraped) {
        results.push({
          id: p.id,
          code: p.shop_product_code,
          status: "not_found",
        });
        continue;
      }

      const patch: Record<string, any> = {};
      if (scraped.image_url) patch.image_url = scraped.image_url;
      if (
        scraped.title_ja &&
        scraped.title_ja.length > (p.name_ja?.length || 0)
      ) {
        patch.name_ja = scraped.title_ja;
      }
      if (Object.keys(patch).length) {
        await sb.from("products").update(patch).eq("id", p.id);
      }

      const uniqueNames = Array.from(new Set(scraped.talents_ja));
      const nameToId = new Map<string, string>();
      if (uniqueNames.length) {
        const { data: existingList } = await sb
          .from("talents")
          .select("id, name_ja")
          .in("name_ja", uniqueNames);
        for (const row of existingList ?? []) {
          if (row.name_ja && !nameToId.has(row.name_ja))
            nameToId.set(row.name_ja, row.id);
        }
        const missing = uniqueNames.filter((n) => !nameToId.has(n));
        if (missing.length) {
          const { data: created } = await sb
            .from("talents")
            .insert(missing.map((name_ja) => ({ name_ja })))
            .select("id, name_ja");
          for (const row of created ?? []) {
            if (row.name_ja) nameToId.set(row.name_ja, row.id);
          }
        }
      }
      const links = Array.from(nameToId.values()).map((tid) => ({
        product_id: p.id,
        talent_id: tid,
      }));
      if (links.length) {
        await sb
          .from("product_talents")
          .upsert(links, { onConflict: "product_id,talent_id" });
      }

      results.push({
        id: p.id,
        code: p.shop_product_code,
        status: "enriched",
        image: !!scraped.image_url,
        talents: scraped.talents_ja,
        talent_count: links.length,
        url: scraped.url,
      });

      await new Promise((r) => setTimeout(r, 800));
    } catch (e: any) {
      results.push({
        id: p.id,
        code: p.shop_product_code,
        status: "error",
        reason: e?.message || String(e),
      });
    }
  }

  const summary = {
    total: products?.length ?? 0,
    enriched: results.filter((r) => r.status === "enriched").length,
    not_found: results.filter((r) => r.status === "not_found").length,
    errors: results.filter((r) => r.status === "error").length,
    mode: mode || (force ? "force" : "missing_image"),
  };

  if (summary.enriched > 0) {
    await notify(
      `🎨 <b>enrich-products 補齊 ${summary.enriched} 筆商品</b>\nhttps://nijisanji-orders.vercel.app`
    );
  }
  if (summary.errors > 0) {
    const firstErr = results.find((r) => r.status === "error");
    await notify(
      `⚠️ <b>enrich-products 有 ${summary.errors} 筆錯誤</b>\n${firstErr?.reason ?? ""}`
    );
  }

  return NextResponse.json({ ok: true, summary, results });
}
