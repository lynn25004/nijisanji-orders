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
  group_id: string | null;
};

type Group = { id: string; name_ja: string; name_en: string | null; kind: string | null };

type Needle = {
  talentIds: string[];
  text: string;
  caseInsensitive: boolean;
  wordBoundary: boolean;
};

// 通用品牌詞，別拿來當 group needle（會炸滿整個本家）
const GENERIC_GROUP_NAMES = new Set([
  "にじさんじ", "NIJISANJI", "nijisanji", "Nijisanji",
  "NIJISANJI EN", "NIJISANJI ID", "NIJISANJI KR",
  "その他",
]);

function buildNeedles(talents: Talent[], groups: Group[]): Needle[] {
  const needles: Needle[] = [];
  for (const t of talents) {
    if (t.name_ja && t.name_ja.length >= 2) {
      // 2 字可接受但要整串連續出現（substring）。單字跳過避免 1 漢字亂撞
      if (t.name_ja.length === 2 && /^[\u4e00-\u9fff]{2}$/.test(t.name_ja)) {
        // 純 2 漢字風險較高（例：夢月）→ 要求更精確：前後非中日文字元或邊界
        needles.push({ talentIds: [t.id], text: t.name_ja, caseInsensitive: false, wordBoundary: false });
      } else {
        needles.push({ talentIds: [t.id], text: t.name_ja, caseInsensitive: false, wordBoundary: false });
      }
    }
    if (t.name_zh && t.name_zh.length >= 2 && t.name_zh !== t.name_ja) {
      needles.push({ talentIds: [t.id], text: t.name_zh, caseInsensitive: false, wordBoundary: false });
    }
    if (t.name_en && t.name_en.length >= 4) {
      needles.push({ talentIds: [t.id], text: t.name_en, caseInsensitive: true, wordBoundary: true });
    }
    for (const a of t.aliases || []) {
      if (a && a.length >= 2) {
        needles.push({ talentIds: [t.id], text: a, caseInsensitive: false, wordBoundary: false });
      }
    }
  }

  // group needles：group 名出現 → 標該 group 所有成員
  const talentsByGroup = new Map<string, string[]>();
  for (const t of talents) {
    if (!t.group_id) continue;
    const arr = talentsByGroup.get(t.group_id) ?? [];
    arr.push(t.id);
    talentsByGroup.set(t.group_id, arr);
  }
  for (const g of groups) {
    if (GENERIC_GROUP_NAMES.has(g.name_ja)) continue;
    const members = talentsByGroup.get(g.id) ?? [];
    if (members.length === 0) continue;
    if (g.name_ja && g.name_ja.length >= 3) {
      needles.push({ talentIds: members, text: g.name_ja, caseInsensitive: true, wordBoundary: false });
    }
    if (g.name_en && g.name_en.length >= 4 && g.name_en !== g.name_ja) {
      needles.push({ talentIds: members, text: g.name_en, caseInsensitive: true, wordBoundary: true });
    }
  }
  return needles;
}

function matchTalents(haystack: string, needles: Needle[]): Set<string> {
  const found = new Set<string>();
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    let hit = false;
    if (n.wordBoundary) {
      const re = new RegExp(`\\b${n.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      hit = re.test(haystack);
    } else if (n.caseInsensitive) {
      hit = lower.includes(n.text.toLowerCase());
    } else {
      hit = haystack.includes(n.text);
    }
    if (hit) n.talentIds.forEach((id) => found.add(id));
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
    .select("id, name_ja, name_zh, name_en, aliases, group_id");
  if (te) return NextResponse.json({ error: te.message }, { status: 500 });

  const { data: groups, error: ge } = await sb
    .from("groups")
    .select("id, name_ja, name_en, kind");
  if (ge) return NextResponse.json({ error: ge.message }, { status: 500 });

  const needles = buildNeedles((talents || []) as Talent[], (groups || []) as Group[]);

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
      const { error } = await sb
        .from("product_talents")
        .upsert(
          toInsert.map((talent_id) => ({ product_id: p.id, talent_id })),
          { onConflict: "product_id,talent_id", ignoreDuplicates: true }
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
