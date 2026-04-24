import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchSheetRows } from "@/lib/parse-sheet";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1c9UKSJTcEIUGYbofOSSTBrdTKL9Su_n0zzq7nZcJsjI/export?format=csv&gid=0";

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

  const sb = supabaseServer();
  const rows = await fetchSheetRows(SHEET_CSV_URL);
  const results: any[] = [];

  for (const row of rows) {
    try {
      // 1. 找既有 order
      const { data: existing } = await sb
        .from("orders")
        .select("id, status, received_at, total_twd, notes")
        .eq("source_email_id", row.dedupKey)
        .maybeSingle();

      if (existing) {
        // 更新狀態/收件日/金額/備註
        const patch: Record<string, any> = {};
        if (existing.status !== row.status) patch.status = row.status;
        if (existing.received_at !== row.receivedAt) patch.received_at = row.receivedAt;
        if (existing.total_twd !== row.totalTwd) patch.total_twd = row.totalTwd;
        if (existing.notes !== row.notes) patch.notes = row.notes;
        if (Object.keys(patch).length) {
          await sb.from("orders").update(patch).eq("id", existing.id);
          results.push({ dedupKey: row.dedupKey, status: "updated", fields: Object.keys(patch) });
        } else {
          results.push({ dedupKey: row.dedupKey, status: "unchanged" });
        }
        continue;
      }

      // 2. 新增 product（用 shop_url 當唯一鍵避免重複）
      const productShopUrl = `sheet://${row.dedupKey}`;
      let productId: string | null = null;
      const { data: existingProduct } = await sb
        .from("products")
        .select("id")
        .eq("shop_url", productShopUrl)
        .maybeSingle();
      if (existingProduct?.id) {
        productId = existingProduct.id;
      } else {
        const { data: newProd, error: pe } = await sb
          .from("products")
          .insert({
            shop_url: productShopUrl,
            name_ja: row.campaignName
          })
          .select("id")
          .single();
        if (pe || !newProd) {
          results.push({ dedupKey: row.dedupKey, status: "error", reason: pe?.message || "product insert failed" });
          continue;
        }
        productId = newProd.id;
      }

      // 3. 新增 order
      const { data: newOrder, error: oe } = await sb
        .from("orders")
        .insert({
          source_email_id: row.dedupKey,
          proxy_service: "跟團",
          ordered_at: row.orderedAt,
          status: row.status,
          received_at: row.receivedAt,
          total_twd: row.totalTwd,
          notes: row.notes
        })
        .select("id")
        .single();
      if (oe || !newOrder) {
        const isDup =
          oe?.code === "23505" ||
          (oe?.message || "").includes("source_email_id");
        results.push({
          dedupKey: row.dedupKey,
          status: isDup ? "skipped" : "error",
          reason: isDup ? "duplicate (race)" : oe?.message || "order insert failed"
        });
        continue;
      }

      // 4. 新增 order_item
      await sb
        .from("order_items")
        .insert({ order_id: newOrder.id, product_id: productId, qty: 1 });

      results.push({ dedupKey: row.dedupKey, status: "inserted", campaign: row.campaignName });
    } catch (e: any) {
      results.push({ dedupKey: row.dedupKey, status: "error", reason: e?.message || String(e) });
    }
  }

  const summary = {
    total: rows.length,
    inserted: results.filter((r) => r.status === "inserted").length,
    updated: results.filter((r) => r.status === "updated").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length
  };

  if (summary.inserted > 0) {
    const campaigns = results
      .filter((r) => r.status === "inserted")
      .map((r) => r.campaign)
      .filter(Boolean)
      .slice(0, 5)
      .join("\n• ");
    await notify(
      `📋 <b>跟團 Sheet 新增 ${summary.inserted} 筆</b>\n• ${campaigns}\nhttps://nijisanji-orders.vercel.app`
    );
  }
  if (summary.errors > 0) {
    const firstErr = results.find((r) => r.status === "error");
    await notify(
      `⚠️ <b>sync-sheet 有 ${summary.errors} 筆錯誤</b>\n${firstErr?.reason ?? ""}`
    );
  }

  return NextResponse.json({ ok: true, summary, results });
}
