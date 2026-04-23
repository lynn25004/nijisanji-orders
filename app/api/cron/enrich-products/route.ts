import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { scrapeShopProduct } from "@/lib/scrape-shop-product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20", 10);
  const force = req.nextUrl.searchParams.get("force") === "1";

  const sb = supabaseServer();

  // 抓缺圖或強制重跑的商品
  let q = sb
    .from("products")
    .select("id, shop_product_code, name_ja, image_url")
    .not("shop_product_code", "is", null)
    .limit(limit);
  if (!force) q = q.is("image_url", null);
  const { data: products, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: any[] = [];

  for (const p of products ?? []) {
    if (!p.shop_product_code) continue;
    try {
      const scraped = await scrapeShopProduct(p.shop_product_code, p.name_ja);
      if (!scraped) {
        results.push({ id: p.id, code: p.shop_product_code, status: "not_found" });
        continue;
      }

      const patch: Record<string, any> = {};
      if (scraped.image_url) patch.image_url = scraped.image_url;
      // 如果 parser 抓到的商品名比 email 的精簡名更長，更新
      if (scraped.title_ja && scraped.title_ja.length > (p.name_ja?.length || 0)) {
        patch.name_ja = scraped.title_ja;
      }
      if (Object.keys(patch).length) {
        await sb.from("products").update(patch).eq("id", p.id);
      }

      // 處理藝人 → talents + product_talents
      const talentIds: string[] = [];
      for (const nameJa of scraped.talents_ja) {
        const { data: existing } = await sb
          .from("talents")
          .select("id")
          .eq("name_ja", nameJa)
          .maybeSingle();
        if (existing?.id) {
          talentIds.push(existing.id);
        } else {
          const { data: created } = await sb
            .from("talents")
            .insert({ name_ja: nameJa })
            .select("id")
            .single();
          if (created?.id) talentIds.push(created.id);
        }
      }
      for (const tid of talentIds) {
        await sb
          .from("product_talents")
          .upsert({ product_id: p.id, talent_id: tid }, { onConflict: "product_id,talent_id" });
      }

      results.push({
        id: p.id,
        code: p.shop_product_code,
        status: "enriched",
        image: !!scraped.image_url,
        talents: scraped.talents_ja,
        url: scraped.url
      });

      // 禮貌延遲：避免被 shop.nijisanji.jp 擋
      await new Promise((r) => setTimeout(r, 800));
    } catch (e: any) {
      results.push({
        id: p.id,
        code: p.shop_product_code,
        status: "error",
        reason: e?.message || String(e)
      });
    }
  }

  const summary = {
    total: products?.length ?? 0,
    enriched: results.filter((r) => r.status === "enriched").length,
    not_found: results.filter((r) => r.status === "not_found").length,
    errors: results.filter((r) => r.status === "error").length
  };

  return NextResponse.json({ ok: true, summary, results });
}
