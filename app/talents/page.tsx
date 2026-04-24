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
        .filter((t) => t.product_count > 0)
        .sort((a, b) => {
          if (!a.debut_at && !b.debut_at) return 0;
          if (!a.debut_at) return 1;
          if (!b.debut_at) return -1;
          return a.debut_at.localeCompare(b.debut_at);
        });
      setTalents(list);
      setLoading(false);
    })();
  }, []);

  const grouped = useMemo(() => {
    const byYear = new Map<string, Talent[]>();
    for (const t of talents) {
      const year = t.debut_at ? t.debut_at.slice(0, 4) : "未知";
      const arr = byYear.get(year) ?? [];
      arr.push(t);
      byYear.set(year, arr);
    }
    return [...byYear.entries()].sort((a, b) => {
      if (a[0] === "未知") return 1;
      if (b[0] === "未知") return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [talents]);

  if (loading) return <p>載入中…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold">我買過的成員</h1>
        <span className="text-sm text-neutral-500">
          共 {talents.length} 位，依出道日期排序
        </span>
      </div>

      {talents.length === 0 ? (
        <p className="text-neutral-500 text-sm">還沒有任何有關聯藝人的商品。</p>
      ) : (
        grouped.map(([year, list]) => (
          <section key={year} className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 pb-1">
              {year === "未知" ? "出道日期未知" : `${year} 年出道`}
              <span className="ml-2 text-xs text-neutral-400">({list.length})</span>
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
