import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { notify } from "@/lib/notify";
import talentsData from "@/data/nijisanji-talents.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Group = {
  name_zh: string;
  name_ja: string;
  members: { name_zh: string; name_ja: string; name_en?: string }[];
};
type Solo = { name_zh: string; name_ja: string; name_en?: string };

const SOLO_GROUP_NAME_JA = "にじさんじ";

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
  const data = talentsData as { groups: Group[]; solo: Solo[] };

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

  const ensureGroup = async (name_ja: string, name_zh: string, kind: string) => {
    const hit = groupMap.get(name_ja);
    if (hit) {
      stats.groups_unchanged++;
      return hit;
    }
    const { data: g, error } = await sb
      .from("groups")
      .insert({ name_ja, name_zh, kind, sort_order: 500 })
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

  const soloGroupId = await ensureGroup(SOLO_GROUP_NAME_JA, "NIJISANJI 本家", "branch");
  if (!soloGroupId)
    return NextResponse.json({ error: "failed to create solo pool group" }, { status: 500 });

  const { data: existingTalents } = await sb
    .from("talents")
    .select("id, name_ja, name_zh, name_en, group_id");

  type TalentRow = {
    id: string;
    name_ja: string;
    name_zh: string | null;
    name_en: string | null;
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
    const existing = talentsByName.get(name_ja);
    if (existing && existing.length > 0) {
      const row = existing[0];
      const patch: Record<string, unknown> = {};
      if (!row.name_zh && name_zh) patch.name_zh = name_zh;
      if (!row.name_en && name_en) patch.name_en = name_en;
      if (!row.group_id) patch.group_id = group_id;
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
    const { error } = await sb
      .from("talents")
      .insert({ name_ja, name_zh, name_en, group_id });
    if (error) {
      stats.errors.push(`talent ${name_ja}: ${error.message}`);
      return;
    }
    stats.talents_inserted++;
  };

  for (const g of data.groups) {
    const gid = await ensureGroup(g.name_ja || g.name_zh, g.name_zh, "unit");
    if (!gid) continue;
    for (const m of g.members) {
      await upsertTalent(m.name_ja, m.name_zh || null, m.name_en || null, gid);
    }
  }
  for (const s of data.solo) {
    await upsertTalent(s.name_ja, s.name_zh || null, s.name_en || null, soloGroupId);
  }

  if (stats.errors.length > 0) {
    await notify(
      `⚠️ <b>import-talents 有 ${stats.errors.length} 筆錯誤</b>\n${stats.errors[0]}`
    );
  }

  return NextResponse.json({ ok: true, stats });
}
