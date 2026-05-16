"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Talent = {
  id: string;
  name_ja: string;
  name_zh: string | null;
  name_en: string | null;
  debut_at: string | null;
  image_url: string | null;
  slug: string | null;
  group_id: string | null;
  groups: { name_ja: string | null; name_zh: string | null } | null;
  product_count: number;
};

export default function TalentsPage() {
  const [talents, setTalents] = useState<Talent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("talents")
        .select(`
          id, name_ja, name_zh, name_en, debut_at, image_url, slug, group_id,
          groups ( name_ja, name_zh ),
          product_talents ( product_id )
        `);
      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }
      const list: Talent[] = (data ?? [])
        .map((t: any) => ({
          id: t.id,
          name_ja: t.name_ja,
          name_zh: t.name_zh,
          name_en: t.name_en,
          debut_at: t.debut_at,
          image_url: t.image_url,
          slug: t.slug,
          group_id: t.group_id,
          groups: t.groups,
          product_count: (t.product_talents ?? []).length
        }))
        .filter((t) => t.product_count > 0);
      setTalents(list);
      setLoading(false);
    })();
  }, []);

  const visibleTalents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return talents;
    return talents.filter((t) =>
      [t.name_ja, t.name_zh, t.name_en, t.groups?.name_ja, t.groups?.name_zh]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q))
    );
  }, [talents, search]);

  // 依團體分組；團體間用「該團體最早出道日」排序，團體內依出道日排序
  const grouped = useMemo(() => {
    const byGroup = new Map<string, Talent[]>();
    for (const t of visibleTalents) {
      const key = t.groups?.name_zh || t.groups?.name_ja || "未分類";
      const arr = byGroup.get(key) ?? [];
      arr.push(t);
      byGroup.set(key, arr);
    }
    const earliestOf = (list: Talent[]) => {
      let min: string | null = null;
      for (const t of list) {
        if (t.debut_at && (!min || t.debut_at < min)) min = t.debut_at;
      }
      return min;
    };
    const sortByDebut = (a: Talent, b: Talent) => {
      if (!a.debut_at && !b.debut_at) return a.name_ja.localeCompare(b.name_ja);
      if (!a.debut_at) return 1;
      if (!b.debut_at) return -1;
      return a.debut_at.localeCompare(b.debut_at);
    };
    return [...byGroup.entries()]
      .map(([k, list]) => ({
        key: k,
        list: [...list].sort(sortByDebut),
        earliest: earliestOf(list)
      }))
      .sort((a, b) => {
        if (a.key === "未分類") return 1;
        if (b.key === "未分類") return -1;
        if (!a.earliest && !b.earliest) return a.key.localeCompare(b.key);
        if (!a.earliest) return 1;
        if (!b.earliest) return -1;
        return a.earliest.localeCompare(b.earliest);
      });
  }, [visibleTalents]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
        {Array.from({ length: 2 }).map((_, s) => (
          <section key={s} className="space-y-2">
            <div className="h-4 w-32 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
            <ul className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                  <div className="aspect-square bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
                  <div className="p-2 space-y-1.5">
                    <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
                    <div className="h-3 w-2/3 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold">我買過的成員</h1>
        <span className="text-sm text-neutral-500">
          共 {talents.length} 位{search && ` · 找到 ${visibleTalents.length} 位`}，依團體 + 出道順序
        </span>
      </div>

      <input
        type="search"
        placeholder="🔍 搜尋成員名 / 團體"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full sm:w-80 border rounded px-3 py-1.5 text-sm bg-transparent"
      />

      {talents.length === 0 ? (
        <p className="text-neutral-500 text-sm">還沒有任何有關聯藝人的商品。</p>
      ) : visibleTalents.length === 0 ? (
        <p className="text-neutral-500 text-sm">沒有符合「{search}」的成員。</p>
      ) : (
        grouped.map(({ key, list, earliest }) => (
          <section key={key} className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 pb-1">
              #{key}
              <span className="ml-2 text-xs text-neutral-400">
                ({list.length}
                {earliest ? ` · ${earliest.slice(0, 4)}~` : ""})
              </span>
            </h2>
            <ul className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {list.map((t) => (
                <li
                  key={t.id}
                  className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 overflow-hidden"
                >
                  <Link
                    href={`/talents/${t.id}`}
                    className="block w-full aspect-square bg-neutral-100 dark:bg-neutral-800 overflow-hidden"
                    title="查看購買記錄"
                  >
                    {t.image_url ? (
                      <img
                        src={t.image_url}
                        alt={t.name_ja}
                        className="w-full h-full object-cover hover:scale-105 transition-transform"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-neutral-500">
                        無圖
                      </div>
                    )}
                  </Link>
                  <div className="p-2">
                    <div className="font-medium text-sm truncate" title={t.name_ja}>
                      {t.name_ja}
                    </div>
                    {(t.name_zh || t.name_en) && t.name_zh !== t.name_ja && (
                      <div className="text-xs text-neutral-500 truncate" title={t.name_zh || t.name_en || ""}>
                        {t.name_zh || t.name_en}
                      </div>
                    )}
                    <div className="text-xs text-neutral-400 mt-1 flex flex-wrap gap-x-1.5">
                      {t.groups?.name_zh || t.groups?.name_ja ? (
                        <span>#{t.groups?.name_zh || t.groups?.name_ja}</span>
                      ) : null}
                      <span>· {t.product_count} 件</span>
                    </div>
                    {t.debut_at && (
                      <div className="text-xs text-neutral-400 mt-0.5">
                        {t.debut_at.slice(0, 10)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

    </div>
  );
}
