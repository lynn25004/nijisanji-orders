import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchLetaoOrders, LetaoOrder } from "@/lib/letao-api";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROXY_SERVICE = "樂淘一番";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function toDate(s: string): string | null {
  // "2026-04-22 23:11:47" → "2026-04-22"
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function money(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header =
    req.headers.get("authorization") || req.headers.get("x-cron-secret") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const qs = req.nextUrl.searchParams.get("secret") || "";
  if (!secret || (token !== secret && qs !== secret)) return unauthorized();

  const letaoToken = process.env.LETAO_AUTH_TOKEN;
  if (!letaoToken) {
    await notify("⚠️ <b>Letao sync 未設定 LETAO_AUTH_TOKEN</b>");
    return NextResponse.json({ error: "LETAO_AUTH_TOKEN missing" }, { status: 500 });
  }

  const sb = supabaseServer();

  let allOrders: LetaoOrder[] = [];
  try {
    // type=8 回傳全部。一次抓 100 筆（使用者目前才 58 筆，未來爆量才分頁）
    const first = await fetchLetaoOrders(letaoToken, { type: 8, page: 1, limit: 100 });
    allOrders = first.list;
    if (first.total > allOrders.length) {
      // 分頁撈剩下的
      let page = 2;
      while (allOrders.length < first.total && page < 20) {
        const next = await fetchLetaoOrders(letaoToken, { type: 8, page, limit: 100 });
        if (!next.list.length) break;
        allOrders = allOrders.concat(next.list);
        page++;
      }
    }
  } catch (e: any) {
    const msg = e?.message || String(e);
    await notify(`⚠️ <b>Letao API 失敗（可能 token 過期）</b>\n${msg}\n到 Vercel 更新 LETAO_AUTH_TOKEN`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // 處理所有 Letao 訂單（NIJISANJI / AMAZON / MERCARI / PAYPAY…）
  const results: any[] = [];
  const byOrigin: Record<string, number> = {};
  for (const o of allOrders) {
    byOrigin[o.originSite] = (byOrigin[o.originSite] || 0) + 1;
  }

  // 批次撈「已存在訂單」：58 次 round-trip 改 1 次
  const dedupKeys = allOrders.map((o) => `letao:${o.orderId}`);
  const existingMap = new Map<string, { id: string; status: string }>();
  if (dedupKeys.length) {
    const { data: existingRows } = await sb
      .from("orders")
      .select("id, status, source_email_id")
      .in("source_email_id", dedupKeys);
    for (const row of existingRows ?? []) {
      if (row.source_email_id) existingMap.set(row.source_email_id, { id: row.id, status: row.status });
    }
  }

  // 批次撈「已存在商品」：每單 1-2 件商品 × 58 訂單 → 1 次查詢
  const allCodes = Array.from(
    new Set(
      allOrders
        .flatMap((o) => o.orderInfoList || [])
        .map((it) => it.externalProductId)
        .filter((c): c is string => !!c)
    )
  );
  const productMap = new Map<string, { id: string; image_url: string | null }>();
  if (allCodes.length) {
    const { data: prodRows } = await sb
      .from("products")
      .select("id, shop_product_code, image_url")
      .in("shop_product_code", allCodes);
    for (const row of prodRows ?? []) {
      if (row.shop_product_code) productMap.set(row.shop_product_code, { id: row.id, image_url: row.image_url });
    }
  }

  for (const o of allOrders) {
    try {
      const dedupKey = `letao:${o.orderId}`;
      const orderedAt = toDate(o.createTime);
      if (!orderedAt) {
        results.push({ orderId: o.orderId, status: "error", reason: "bad date" });
        continue;
      }

      const existing = existingMap.get(dedupKey);

      if (existing) {
        // 更新狀態
        if (existing.status !== o.orderStatus) {
          await sb.from("orders").update({ status: o.orderStatus }).eq("id", existing.id);
          results.push({ orderId: o.orderId, status: "updated", new_status: o.orderStatus });
        } else {
          results.push({ orderId: o.orderId, status: "unchanged" });
        }
        continue;
      }

      // 新增訂單
      const { data: newOrder, error: oe } = await sb
        .from("orders")
        .insert({
          source_email_id: dedupKey,
          proxy_service: PROXY_SERVICE,
          proxy_order_no: o.orderId,
          ordered_at: orderedAt,
          status: o.orderStatus,
          total_jpy: money(o.payPrice),
          shipping_jpy: money(o.payPostage) ?? 0,
          notes: null
        })
        .select("id")
        .single();
      if (oe || !newOrder) {
        const isDup =
          oe?.code === "23505" ||
          (oe?.message || "").includes("source_email_id");
        results.push({
          orderId: o.orderId,
          status: isDup ? "skipped" : "error",
          reason: isDup ? "dup (race)" : oe?.message || "insert failed"
        });
        continue;
      }

      // 每項商品
      for (const it of o.orderInfoList || []) {
        let productId: string | null = null;
        const code = it.externalProductId || null;

        if (code) {
          const existingProduct = productMap.get(code);
          if (existingProduct) {
            productId = existingProduct.id;
            // 補圖（如果原本沒有）
            if (!existingProduct.image_url && it.image) {
              await sb
                .from("products")
                .update({ image_url: it.image })
                .eq("id", productId);
              existingProduct.image_url = it.image;
            }
          }
        }

        if (!productId) {
          const { data: newProd, error: pe } = await sb
            .from("products")
            .insert({
              shop_product_code: code,
              name_ja: it.storeName,
              image_url: it.image,
              list_price_jpy: money(it.price)
            })
            .select("id")
            .single();
          if (pe || !newProd) {
            results.push({
              orderId: o.orderId,
              status: "error",
              reason: `product insert: ${pe?.message}`
            });
            continue;
          }
          productId = newProd.id;
          if (code) productMap.set(code, { id: newProd.id, image_url: it.image ?? null });
        }

        await sb.from("order_items").insert({
          order_id: newOrder.id,
          product_id: productId,
          qty: it.cartNum,
          unit_price_jpy: money(it.price)
        });
      }

      results.push({ orderId: o.orderId, status: "inserted" });
    } catch (e: any) {
      results.push({ orderId: o.orderId, status: "error", reason: e?.message || String(e) });
    }
  }

  const summary = {
    total_fetched: allOrders.length,
    by_origin: byOrigin,
    inserted: results.filter((r) => r.status === "inserted").length,
    updated: results.filter((r) => r.status === "updated").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length
  };

  if (summary.inserted > 0) {
    await notify(
      `🛍️ <b>樂淘一番新訂單 ${summary.inserted} 筆</b>\nhttps://nijisanji-orders.vercel.app`
    );
  }
  if (summary.errors > 0) {
    const firstErr = results.find((r) => r.status === "error");
    await notify(`⚠️ <b>sync-letao 有 ${summary.errors} 筆錯誤</b>\n${firstErr?.reason ?? ""}`);
  }

  return NextResponse.json({ ok: true, summary, results });
}
