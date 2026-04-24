import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

type Talent = {
  id: string;
  name_ja: string;
  name_zh: string | null;
  name_en: string | null;
  aliases: string[] | null;
};

type Needle = { talentId: string; text: string; caseInsensitive: boolean; wordBoundary: boolean };

function buildNeedles(talents: Talent[]): Needle[] {
  const needles: Needle[] = [];
  for (const t of talents) {
    if (t.name_ja && t.name_ja.length >= 3) {
      needles.push({ talentId: t.id, text: t.name_ja, caseInsensitive: false, wordBoundary: false });
    }
    if (t.name_zh && t.name_zh.length >= 2 && t.name_zh !== t.name_ja) {
      needles.push({ talentId: t.id, text: t.name_zh, caseInsensitive: false, wordBoundary: false });
    }
    if (t.name_en && t.name_en.length >= 4) {
      needles.push({ talentId: t.id, text: t.name_en, caseInsensitive: true, wordBoundary: true });
    }
    for (const a of t.aliases || []) {
      if (a && a.length >= 2) {
        needles.push({ talentId: t.id, text: a, caseInsensitive: false, wordBoundary: false });
      }
    }
  }
  return needles;
}

function matchTalents(haystack: string, needles: Needle[]): Set<string> {
  const found = new Set<string>();
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (n.wordBoundary) {
      const re = new RegExp(`\\b${n.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(haystack)) found.add(n.talentId);
    } else if (n.caseInsensitive) {
      if (lower.includes(n.text.toLowerCase())) found.add(n.talentId);
    } else {
      if (haystack.includes(n.text)) found.add(n.talentId);
    }
  }
  return found;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header =
    req.headers.get("authorization") || req.headers.get("x-cron-secret") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const qs = req.nextUrl.searchParams.get("secret") || "";
  if (!secret || (token !== secret && qs !== secret)) return unauthorized();

  const force = req.nextUrl.searchParams.get("force") === "1";

  const sb = supabaseServer();

  const { data: talents, error: te } = await sb
    .from("talents")
    .select("id, name_ja, name_zh, name_en, aliases");
  if (te) return NextResponse.json({ error: te.message }, { status: 500 });

  const needles = buildNeedles((talents || []) as Talent[]);

  let query = sb.from("products").select("id, name_ja, name_zh, auto_tagged_at");
  if (!force) query = query.is("auto_tagged_at", null);
  const { data: products, error: pe } = await query;
  if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });

  const { data: existingLinks } = await sb
    .from("product_talents")
    .select("product_id, talent_id");
  const existing = new Map<string, Set<string>>();
  existingLinks?.forEach((l) => {
    const s = existing.get(l.product_id) ?? new Set<string>();
    s.add(l.talent_id);
    existing.set(l.product_id, s);
  });

  const results = {
    scanned: products?.length || 0,
    tagged: 0,
    untagged: 0,
    new_links: 0,
    errors: [] as string[],
  };

  for (const p of products || []) {
    const text = `${p.name_ja || ""} ${p.name_zh || ""}`;
    const hits = matchTalents(text, needles);
    const already = existing.get(p.id) ?? new Set<string>();
    const toInsert = [...hits].filter((id) => !already.has(id));
    if (toInsert.length > 0) {
      const { error } = await sb.from("product_talents").insert(
        toInsert.map((talent_id) => ({ product_id: p.id, talent_id }))
      );
      if (error) {
        results.errors.push(`${p.id}: ${error.message}`);
      } else {
        results.new_links += toInsert.length;
      }
    }
    if (hits.size > 0) results.tagged++;
    else results.untagged++;
    await sb
      .from("products")
      .update({ auto_tagged_at: new Date().toISOString() })
      .eq("id", p.id);
  }

  if (results.new_links > 0) {
    await notify(
      `🏷️ <b>auto-tag 新增 ${results.new_links} 筆商品↔藝人關聯</b>\n(${results.tagged}/${results.scanned} 商品有辨識到)`
    );
  }
  if (results.errors.length > 0) {
    await notify(
      `⚠️ <b>auto-tag 有 ${results.errors.length} 筆錯誤</b>\n${results.errors[0]}`
    );
  }

  return NextResponse.json({ ok: true, results });
}
