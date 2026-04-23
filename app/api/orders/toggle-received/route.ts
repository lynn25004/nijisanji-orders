import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { order_id } = await req.json().catch(() => ({}));
  if (!order_id) return NextResponse.json({ error: "missing order_id" }, { status: 400 });

  const sb = supabaseServer();
  const { data: cur, error: e1 } = await sb
    .from("orders")
    .select("received_at")
    .eq("id", order_id)
    .maybeSingle();
  if (e1 || !cur) return NextResponse.json({ error: e1?.message || "not found" }, { status: 404 });

  const next = cur.received_at ? null : new Date().toISOString().slice(0, 10);
  const { error: e2 } = await sb
    .from("orders")
    .update({ received_at: next })
    .eq("id", order_id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({ ok: true, received_at: next });
}
