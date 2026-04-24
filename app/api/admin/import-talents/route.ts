import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { notify } from "@/lib/notify";
import { generateAliases } from "@/lib/talent-aliases";
import jpData from "@/data/nijisanji-talents.json";
import enData from "@/data/nijisanji-en-talents.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Group = {
  name_zh: string;
  name_ja: string;
  name_en?: string;
  members: { name_zh: string; name_ja: string; name_en?: string }[];
};
type Solo = { name_zh: string; name_ja: string; name_en?: string };

const JP_SOLO_GROUP_NAME_JA = "にじさんじ";
const EN_SOLO_GROUP_NAME_JA = "NIJISANJI EN";

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

  const stats = {
    groups_inserted: 0,
    groups_unchanged: 0,
    talents_inserted: 0,
    talents_updated: 0,
    talents_unchanged: 0,
    errors: [] as string[],
  };

  const { data: existingGroups } = await sb
    .from("groups")
    .select("id, name_ja");
  const groupMap = new Map<string, string>();
  existingGroups?.forEach((g) => groupMap.set(g.name_ja, g.id));

  const ensureGroup = async (
    name_ja: string,
    name_zh: string,
    kind: string,
    name_en?: string
  ) => {
    const hit = groupMap.get(name_ja);
    if (hit) {
      if (name_en) {
        await sb.from("groups").update({ name_en }).eq("id", hit).is("name_en", null);
      }
      stats.groups_unchanged++;
      return hit;
    }
    const { data: g, error } = await sb
      .from("groups")
      .insert({ name_ja, name_zh, name_en: name_en || null, kind, sort_order: 500 })
      .select("id")
      .single();
    if (error || !g) {
      stats.errors.push(`group ${name_ja}: ${error?.message || "insert failed"}`);
      return null;
    }
    groupMap.set(name_ja, g.id);
    stats.groups_inserted++;
    return g.id;
  };

  const jpSoloId = await ensureGroup(JP_SOLO_GROUP_NAME_JA, "NIJISANJI 本家", "branch");
  const enSoloId = await ensureGroup(EN_SOLO_GROUP_NAME_JA, "NIJISANJI EN", "branch", "NIJISANJI EN");
  if (!jpSoloId || !enSoloId)
    return NextResponse.json({ error: "failed to create branch group" }, { status: 500 });

  const { data: existingTalents } = await sb
    .from("talents")
    .select("id, name_ja, name_zh, name_en, aliases, group_id");

  type TalentRow = {
    id: string;
    name_ja: string;
    name_zh: string | null;
    name_en: string | null;
    aliases: string[] | null;
    group_id: string | null;
  };
  const talentsByName = new Map<string, TalentRow[]>();
  (existingTalents as TalentRow[] | null)?.forEach((t) => {
    const arr = talentsByName.get(t.name_ja) ?? [];
    arr.push(t);
    talentsByName.set(t.name_ja, arr);
  });

  const upsertTalent = async (
    name_ja: string,
    name_zh: string | null,
    name_en: string | null,
    group_id: string
  ) => {
    const aliases = generateAliases(name_ja, name_en);
    const existing = talentsByName.get(name_ja);
    if (existing && existing.length > 0) {
      const row = existing[0];
      const patch: Record<string, unknown> = {};
      if (!row.name_zh && name_zh) patch.name_zh = name_zh;
      if (!row.name_en && name_en) patch.name_en = name_en;
      if (!row.group_id) patch.group_id = group_id;
      if (!row.aliases || row.aliases.length === 0) {
        if (aliases.length > 0) patch.aliases = aliases;
      }
      if (Object.keys(patch).length === 0) {
        stats.talents_unchanged++;
        return;
      }
      const { error } = await sb.from("talents").update(patch).eq("id", row.id);
      if (error) {
        stats.errors.push(`talent ${name_ja}: ${error.message}`);
        return;
      }
      stats.talents_updated++;
      return;
    }
    const { error } = await sb.from("talents").insert({
      name_ja,
      name_zh,
      name_en,
      group_id,
      aliases: aliases.length > 0 ? aliases : null,
    });
    if (error) {
      stats.errors.push(`talent ${name_ja}: ${error.message}`);
      return;
    }
    stats.talents_inserted++;
  };

  // JP 本家
  const jpFull = jpData as { groups: Group[]; solo: Solo[] };
  for (const g of jpFull.groups) {
    const gid = await ensureGroup(g.name_ja || g.name_zh, g.name_zh, "unit");
    if (!gid) continue;
    for (const m of g.members) {
      await upsertTalent(m.name_ja, m.name_zh || null, m.name_en || null, gid);
    }
  }
  for (const s of jpFull.solo) {
    await upsertTalent(s.name_ja, s.name_zh || null, s.name_en || null, jpSoloId);
  }

  // EN 分部
  const enFull = enData as { groups: Group[]; solo: Solo[] };
  for (const g of enFull.groups) {
    const gid = await ensureGroup(
      g.name_ja || g.name_en || g.name_zh,
      g.name_zh,
      "unit",
      g.name_en
    );
    if (!gid) continue;
    for (const m of g.members) {
      const enName = m.name_en || null;
      // EN 成員 name_ja 常等於英文或片假名，若空就用 name_en 當 name_ja
      const jaName = m.name_ja || enName || m.name_zh;
      if (!jaName) continue;
      await upsertTalent(jaName, m.name_zh || null, enName, gid);
    }
  }
  for (const s of enFull.solo) {
    const enName = s.name_en || null;
    const jaName = s.name_ja || enName || s.name_zh;
    if (!jaName) continue;
    await upsertTalent(jaName, s.name_zh || null, enName, enSoloId);
  }

  if (stats.errors.length > 0) {
    await notify(
      `⚠️ <b>import-talents 有 ${stats.errors.length} 筆錯誤</b>\n${stats.errors[0]}`
    );
  }

  return NextResponse.json({ ok: true, stats });
}
