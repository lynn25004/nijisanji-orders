"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Item = {
  qty: number;
  unit_price_jpy: number | null;
  ordered_at: string;
  order_id: string;
  product_id: string;
  product_name: string;
  image_url: string | null;
  talents: { id: string; name_ja: string; name_zh: string | null; image_url: string | null }[];
};

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

export default function WrapPage() {
  const params = useParams();
  const year = (params?.year as string) || String(new Date().getFullYear());
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [jpyToTwd, setJpyToTwd] = useState<number>(0.21);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("order_items")
        .select(`
          qty, unit_price_jpy,
          orders!inner ( id, ordered_at ),
          products!inner (
            id, name_ja, image_url,
            product_talents ( talents ( id, name_ja, name_zh, image_url ) )
          )
        `)
        .gte("orders.ordered_at", `${year}-01-01`)
        .lt("orders.ordered_at", `${parseInt(year, 10) + 1}-01-01`);
      const flat: Item[] = (data ?? []).map((r: any) => ({
        qty: r.qty,
        unit_price_jpy: r.unit_price_jpy,
        ordered_at: r.orders.ordered_at,
        order_id: r.orders.id,
        product_id: r.products.id,
        product_name: r.products.name_ja,
        image_url: r.products.image_url,
        talents: (r.products.product_talents ?? [])
          .map((pt: any) => pt.talents)
          .filter(Boolean)
      }));
      setItems(flat);
      setLoading(false);
    })();

    try {
      const cached = localStorage.getItem("jpyToTwd");
      if (cached) {
        const { rate } = JSON.parse(cached);
        if (typeof rate === "number") setJpyToTwd(rate);
      }
    } catch {}
  }, [year]);

  const stats = useMemo(() => {
    let totalSpend = 0;
    let maxOrderSpend = 0;
    let maxOrderName = "";
    let maxOrderImg: string | null = null;
    const orderIds = new Set<string>();
    const productIds = new Set<string>();
    const monthSpend = Array(12).fill(0);
    const talentCount = new Map<string, { count: number; talent: any }>();
    const productSpend = new Map<string, { spend: number; product: { name: string; image_url: string | null } }>();

    for (const r of items) {
      const amt = (r.unit_price_jpy ?? 0) * r.qty;
      totalSpend += amt;
      orderIds.add(r.order_id);
      productIds.add(r.product_id);
      const m = parseInt(r.ordered_at.slice(5, 7), 10) - 1;
      if (m >= 0 && m < 12) monthSpend[m] += amt;

      // 單張訂單最大金額（聚合 by order_id 才準）
      // 簡化：用單品 amt 作為「最大單品」
      if (amt > maxOrderSpend) {
        maxOrderSpend = amt;
        maxOrderName = r.product_name;
        maxOrderImg = r.image_url;
      }

      for (const t of r.talents) {
        const cur = talentCount.get(t.id) ?? { count: 0, talent: t };
        cur.count += r.qty;
        talentCount.set(t.id, cur);
      }

      const ps = productSpend.get(r.product_id) ?? {
        spend: 0,
        product: { name: r.product_name, image_url: r.image_url }
      };
      ps.spend += amt;
      productSpend.set(r.product_id, ps);
    }

    const topTalents = Array.from(talentCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const topProducts = Array.from(productSpend.values())
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 3);
    const peakMonth = monthSpend.indexOf(Math.max(...monthSpend));

    return {
      totalSpend,
      orderCount: orderIds.size,
      productCount: productIds.size,
      talentCount: talentCount.size,
      monthSpend,
      maxMonth: Math.max(...monthSpend),
      peakMonth,
      topTalents,
      topProducts,
      maxOrderSpend,
      maxOrderName,
      maxOrderImg
    };
  }, [items]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
        <div className="h-64 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 space-y-3">
        <h1 className="text-2xl font-bold">📭 {year} 還沒有任何訂單</h1>
        <p className="text-neutral-500">換個年份試試</p>
        <div className="flex gap-2 justify-center pt-4">
          <Link href={`/wrap/${parseInt(year, 10) - 1}`} className="border rounded px-3 py-1.5">← {parseInt(year, 10) - 1}</Link>
          <Link href={`/wrap/${parseInt(year, 10) + 1}`} className="border rounded px-3 py-1.5">{parseInt(year, 10) + 1} →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 max-w-2xl mx-auto">
      <div className="flex items-baseline justify-between">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">← 回首頁</Link>
        <div className="flex gap-2 text-sm">
          <Link href={`/wrap/${parseInt(year, 10) - 1}`} className="text-neutral-500 hover:underline">{parseInt(year, 10) - 1}</Link>
          <Link href={`/wrap/${parseInt(year, 10) + 1}`} className="text-neutral-500 hover:underline">{parseInt(year, 10) + 1}</Link>
        </div>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600 via-pink-500 to-amber-400 p-8 text-white text-center">
        <div className="text-sm opacity-80">{year} 年</div>
        <h1 className="text-4xl sm:text-5xl font-black mt-2">我的彩虹社</h1>
        <div className="text-2xl mt-1">推し活回顧</div>
        <div className="mt-6 text-6xl sm:text-7xl font-black drop-shadow-lg">
          ¥{stats.totalSpend.toLocaleString()}
        </div>
        <div className="text-sm opacity-90 mt-1">
          ≈ NT${Math.round(stats.totalSpend * jpyToTwd).toLocaleString()}
        </div>
        <div className="mt-3 text-base">這一年的全部花費</div>
      </section>

      {/* 大數字 */}
      <section className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="商品" value={stats.productCount} unit="件" />
        <Stat label="訂單" value={stats.orderCount} unit="筆" />
        <Stat label="推" value={stats.talentCount} unit="位" />
      </section>

      {/* Top 推 */}
      {stats.topTalents.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">🥇 最常買的推</h2>
          <div className="space-y-2">
            {stats.topTalents.map((t, i) => (
              <Link
                key={t.talent.id}
                href={`/talents/${t.talent.id}`}
                className="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 hover:shadow"
              >
                <div className="text-3xl font-black w-10 text-center">{i + 1}</div>
                {t.talent.image_url ? (
                  <img src={t.talent.image_url} alt="" className="w-14 h-14 object-cover rounded-full shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-neutral-200 dark:bg-neutral-800 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{t.talent.name_ja}</div>
                  {t.talent.name_zh && t.talent.name_zh !== t.talent.name_ja && (
                    <div className="text-xs text-neutral-500 truncate">{t.talent.name_zh}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-bold">{t.count}</div>
                  <div className="text-xs text-neutral-500">件商品</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Top 商品 */}
      {stats.topProducts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">💸 最砸錢的商品</h2>
          <div className="space-y-2">
            {stats.topProducts.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900"
              >
                <div className="text-2xl font-black w-8 text-center">{i + 1}</div>
                {p.product.image_url ? (
                  <img src={p.product.image_url} alt="" className="w-14 h-14 object-cover rounded shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded bg-neutral-200 dark:bg-neutral-800 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{p.product.name}</div>
                  <div className="text-xs text-neutral-500">¥{p.spend.toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 月支出柱狀 */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold">📊 月支出</h2>
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 bg-white dark:bg-neutral-900">
          <div className="flex items-end gap-1 h-32">
            {stats.monthSpend.map((amt, i) => {
              const h = stats.maxMonth > 0 ? (amt / stats.maxMonth) * 100 : 0;
              const isPeak = i === stats.peakMonth && amt > 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-neutral-500 h-3">
                    {amt > 0 ? `¥${(amt / 1000).toFixed(0)}k` : ""}
                  </div>
                  <div
                    className={`w-full rounded-t transition-all ${isPeak ? "bg-pink-500" : "bg-neutral-300 dark:bg-neutral-700"}`}
                    style={{ height: `${h}%`, minHeight: amt > 0 ? "2px" : "0" }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1 mt-1">
            {MONTH_LABELS.map((m, i) => (
              <div key={i} className="flex-1 text-center text-[10px] text-neutral-500">{m}</div>
            ))}
          </div>
          {stats.maxMonth > 0 && (
            <div className="text-sm text-center mt-3 text-neutral-600 dark:text-neutral-400">
              {MONTH_LABELS[stats.peakMonth]} 是燒錢之最 · ¥{stats.maxMonth.toLocaleString()}
            </div>
          )}
        </div>
      </section>

      {/* 最大單品 */}
      {stats.maxOrderName && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">👑 最高單筆</h2>
          <div className="flex items-center gap-3 p-4 border-2 border-amber-400 rounded-lg bg-amber-50 dark:bg-amber-950/30">
            {stats.maxOrderImg ? (
              <img src={stats.maxOrderImg} alt="" className="w-20 h-20 object-cover rounded shrink-0" />
            ) : (
              <div className="w-20 h-20 rounded bg-neutral-200 dark:bg-neutral-800 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-bold">{stats.maxOrderName}</div>
              <div className="text-2xl font-black mt-1">¥{stats.maxOrderSpend.toLocaleString()}</div>
            </div>
          </div>
        </section>
      )}

      {/* 結尾 */}
      <section className="text-center py-8 space-y-2">
        <div className="text-2xl">🎉</div>
        <div className="text-sm text-neutral-500">{year} 推し活，辛苦了！</div>
        <div className="text-xs text-neutral-400">截圖分享給朋友 →</div>
      </section>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 bg-white dark:bg-neutral-900 text-center">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-3xl font-black mt-1">{value}</div>
      <div className="text-xs text-neutral-500">{unit}</div>
    </div>
  );
}
