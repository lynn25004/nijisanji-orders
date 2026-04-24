import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { scrapeShopProduct } from "@/lib/scrape-shop-product";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel hobby plan 上限 60s；cron 每 6 小時跑一次補缺即可
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

  // 每支商品要抓 sitemap + 頁面（~3s 實測）
  // cron-job.org 免費版 timeout 上限 30s → 限 5 筆 + 軟上限 25s
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "5", 10);
  const force = req.nextUrl.searchParams.get("force") === "1";
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = 25_000;

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
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      results.push({ id: p.id, code: p.shop_product_code, status: "skipped_deadline" });
      continue;
    }
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
        // 用 limit(1) 而非 maybeSingle()，避免已有重複 row 時誤判為「不存在」而再插一筆
        const { data: existingList } = await sb
          .from("talents")
          .select("id")
          .eq("name_ja", nameJa)
          .limit(1);
        if (existingList && existingList.length > 0) {
          talentIds.push(existingList[0].id);
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
