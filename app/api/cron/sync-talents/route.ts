import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { notify, esc } from "@/lib/notify";
import { generateAliases } from "@/lib/talent-aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 從 nijisanji.jp/talents 官方名單補新成員（JP + EN，不收 VirtuaReal）
// 新成員 group_id 留 null → DB trigger auto_assign_talent_group 依 debut_at 歸「○年○月組」
const AFFILIATIONS = new Set(["にじさんじ", "NIJISANJI EN"]);

type Liver = {
  slug: string;
  name: string;
  enName?: string;
  profile?: { affiliation?: string[]; debutAt?: string };
  images?: { head?: { url?: string } };
};

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function decodeImage(proxyUrl?: string): string | null {
  if (!proxyUrl) return null;
  const m = proxyUrl.match(/url=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchOfficialLivers(): Promise<Liver[]> {
  const res = await fetch("https://www.nijisanji.jp/talents", {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ja" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`nijisanji.jp ${res.status}`);
  const html = await res.text();
  const i = html.indexOf('"allLivers":[');
  if (i < 0) throw new Error("allLivers not found");
  const start = i + '"allLivers":'.length;
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    if (html[j] === "[") depth++;
    else if (html[j] === "]" && --depth === 0) {
      return JSON.parse(html.substring(start, j + 1));
    }
  }
  throw new Error("allLivers array end not found");
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header =
    req.headers.get("authorization") || req.headers.get("x-cron-secret") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const qs = req.nextUrl.searchParams.get("secret") || "";
  if (!secret || (token !== secret && qs !== secret)) return unauthorized();

  const sb = supabaseServer();

  let livers: Liver[];
  try {
    livers = (await fetchOfficialLivers()).filter((l) =>
      (l.profile?.affiliation ?? []).some((a) => AFFILIATIONS.has(a))
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notify(`⚠️ <b>sync-talents 抓官網失敗</b>\n${esc(msg)}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const { data: existing, error: te } = await sb
    .from("talents")
    .select("id, name_ja, name_en, slug, debut_at, image_url");
  if (te) return NextResponse.json({ error: te.message }, { status: 500 });

  const bySlug = new Map(existing!.filter((t) => t.slug).map((t) => [t.slug, t]));
  const byName = new Map(existing!.map((t) => [t.name_ja, t]));

  const inserted: string[] = [];
  const errors: string[] = [];
  let updated = 0;

  for (const l of livers) {
    const debut_at = l.profile?.debutAt ?? null;
    const image_url = decodeImage(l.images?.head?.url);
    const name_en = l.enName || null;
    const row = bySlug.get(l.slug) || byName.get(l.name);

    if (row) {
      // 只補空欄位，不覆寫手動改過的資料
      const patch: Record<string, unknown> = {};
      if (!row.slug) patch.slug = l.slug;
      if (!row.name_en && name_en) patch.name_en = name_en;
      if (!row.debut_at && debut_at) patch.debut_at = debut_at;
      if (!row.image_url && image_url) patch.image_url = image_url;
      if (Object.keys(patch).length === 0) continue;
      const { error } = await sb.from("talents").update(patch).eq("id", row.id);
      if (error) errors.push(`update ${l.name}: ${error.message}`);
      else updated++;
      continue;
    }

    const { error } = await sb.from("talents").insert({
      name_ja: l.name,
      name_en,
      slug: l.slug,
      debut_at,
      image_url,
      aliases: generateAliases(l.name, name_en),
    });
    if (error) errors.push(`insert ${l.name}: ${error.message}`);
    else inserted.push(l.name);
  }

  // 有新成員 → 清掉 auto_tagged_at，讓 auto-tag-products 下次重掃全部商品
  if (inserted.length > 0) {
    await sb.from("products").update({ auto_tagged_at: null }).not("auto_tagged_at", "is", null);
    await notify(
      `🆕 <b>新增 ${inserted.length} 位成員</b>\n${esc(inserted.join("、"))}`
    );
  }
  if (errors.length > 0) {
    await notify(
      `⚠️ <b>sync-talents 有 ${errors.length} 筆錯誤</b>\n${esc(errors[0])}`
    );
  }

  return NextResponse.json({
    ok: true,
    official: livers.length,
    inserted,
    updated,
    errors,
  });
}
