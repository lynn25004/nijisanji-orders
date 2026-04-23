import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchShopNijisanjiOrderEmails } from "@/lib/gmail-imap";
import { parseShopNijisanjiOrder } from "@/lib/parse-shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROXY_SERVICE = "shop.nijisanji.jp (直購)";

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

  const sinceDays = parseInt(
    req.nextUrl.searchParams.get("days") || "180",
    10
  );

  const sb = supabaseServer();
  const emails = await fetchShopNijisanjiOrderEmails({ sinceDays });

  const results: Array<{
    messageId: string;
    status: "inserted" | "skipped" | "error";
    order_no?: string;
    reason?: string;
  }> = [];

  for (const mail of emails) {
    try {
      // 去重：source_email_id 已存在就跳過
      const { data: exists } = await sb
        .from("orders")
        .select("id")
        .eq("source_email_id", mail.messageId)
        .maybeSingle();
      if (exists) {
        results.push({
          messageId: mail.messageId,
          status: "skipped",
          reason: "already imported"
        });
        continue;
      }

      const parsed = parseShopNijisanjiOrder(mail.text || mail.html, {
        receivedAt: mail.date,
        subject: mail.subject
      });
      if (!parsed) {
        results.push({
          messageId: mail.messageId,
          status: "error",
          reason: "parse failed"
        });
        continue;
      }

      // 插 orders
      const { data: orderRow, error: orderErr } = await sb
        .from("orders")
        .insert({
          proxy_service: PROXY_SERVICE,
          proxy_order_no: parsed.order_no,
          ordered_at: parsed.ordered_at.toISOString(),
          status: "completed",
          total_jpy: parsed.total_jpy,
          proxy_fee_jpy: 0,
          shipping_jpy: 0,
          notes: parsed.payment_method
            ? `payment: ${parsed.payment_method}`
            : null,
          source_email_id: mail.messageId
        })
        .select("id")
        .single();
      if (orderErr || !orderRow) {
        // unique constraint 撞到代表此信件已匯入過 → skip（idempotent）
        const isDup =
          orderErr?.code === "23505" ||
          (orderErr?.message || "").includes("orders_source_email_id_key");
        results.push({
          messageId: mail.messageId,
          status: isDup ? "skipped" : "error",
          reason: isDup
            ? "already imported (unique)"
            : orderErr?.message || "insert order failed"
        });
        continue;
      }

      // 處理每個商品：upsert products by shop_product_code
      for (const it of parsed.items) {
        let productId: string | null = null;

        if (it.shop_product_code) {
          const { data: existedProd } = await sb
            .from("products")
            .select("id")
            .eq("shop_product_code", it.shop_product_code)
            .maybeSingle();
          if (existedProd) {
            productId = existedProd.id;
          }
        }

        if (!productId) {
          const { data: newProd, error: prodErr } = await sb
            .from("products")
            .insert({
              shop_product_code: it.shop_product_code,
              name_ja: it.name_ja,
              list_price_jpy: it.unit_price_jpy
            })
            .select("id")
            .single();
          if (prodErr || !newProd) {
            results.push({
              messageId: mail.messageId,
              status: "error",
              order_no: parsed.order_no,
              reason: `product insert: ${prodErr?.message}`
            });
            continue;
          }
          productId = newProd.id;
        }

        await sb.from("order_items").insert({
          order_id: orderRow.id,
          product_id: productId,
          qty: it.qty,
          unit_price_jpy: it.unit_price_jpy
        });
      }

      results.push({
        messageId: mail.messageId,
        status: "inserted",
        order_no: parsed.order_no
      });
    } catch (e: any) {
      results.push({
        messageId: mail.messageId,
        status: "error",
        reason: e?.message || String(e)
      });
    }
  }

  const summary = {
    fetched: emails.length,
    inserted: results.filter((r) => r.status === "inserted").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length
  };

  return NextResponse.json({ ok: true, summary, results });
}
