"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TalentDetail = {
  id: string;
  name_ja: string;
  name_zh: string | null;
  name_en: string | null;
  debut_at: string | null;
  image_url: string | null;
  slug: string | null;
  group_name: string | null;
};

type Product = {
  id: string;
  name_ja: string;
  image_url: string | null;
  release_date: string | null;
  order_id: string;
  ordered_at: string;
  received_at: string | null;
  qty: number;
  unit_price_jpy: number | null;
};

export default function TalentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) || "";
  const [t, setT] = useState<TalentDetail | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoomImg, setZoomImg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: tRow } = await supabase
        .from("talents")
        .select("id,name_ja,name_zh,name_en,debut_at,image_url,slug, groups(name_ja,name_zh)")
        .eq("id", id)
        .single();
      if (tRow) {
        const grp = (tRow as any).groups;
        setT({
          id: tRow.id,
          name_ja: tRow.name_ja,
          name_zh: tRow.name_zh,
          name_en: tRow.name_en,
          debut_at: tRow.debut_at,
          image_url: tRow.image_url,
          slug: tRow.slug,
          group_name: grp?.name_zh || grp?.name_ja || null
        });
      }
      // 商品 + 訂單明細
      const { data: items } = await supabase
        .from("product_talents")
        .select(`
          product_id,
          products!inner (
            id, name_ja, image_url, release_date,
            order_items ( qty, unit_price_jpy, orders!inner ( id, ordered_at, received_at ) )
          )
        `)
        .eq("talent_id", id);
      const prods: Product[] = [];
      for (const link of items ?? []) {
        const p = (link as any).products;
        if (!p) continue;
        for (const oi of p.order_items || []) {
          prods.push({
            id: p.id,
            name_ja: p.name_ja,
            image_url: p.image_url,
            release_date: p.release_date,
            order_id: oi.orders.id,
            ordered_at: oi.orders.ordered_at,
            received_at: oi.orders.received_at,
            qty: oi.qty,
            unit_price_jpy: oi.unit_price_jpy
          });
        }
      }
      prods.sort((a, b) => (a.ordered_at < b.ordered_at ? 1 : -1));
      setProducts(prods);
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!zoomImg) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomImg(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomImg]);

  if (loading) return <p>載入中…</p>;
  if (!t) return <p>找不到這位成員。<Link href="/talents" className="underline">回列表</Link></p>;

  const totalQty = products.reduce((a, b) => a + b.qty, 0);
  const totalJpy = products.reduce((a, b) => a + (b.unit_price_jpy || 0) * b.qty, 0);

  return (
    <div className="space-y-5">
      <button onClick={() => router.back()} className="text-sm text-neutral-500 hover:underline">← 返回</button>

      <div className="flex flex-col sm:flex-row gap-4 items-start">
        {t.image_url ? (
          <button
            type="button"
            onClick={() => setZoomImg(t.image_url!)}
            className="w-48 h-48 shrink-0 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800"
            title="點擊放大"
          >
            <img src={t.image_url} alt={t.name_ja} className="w-full h-full object-cover hover:scale-105 transition-transform" />
          </button>
        ) : (
          <div className="w-48 h-48 shrink-0 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500">無圖</div>
        )}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t.name_ja}</h1>
          {t.name_en && <div className="text-sm text-neutral-500">{t.name_en}</div>}
          {t.name_zh && t.name_zh !== t.name_ja && <div className="text-sm text-neutral-500">{t.name_zh}</div>}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-500 pt-2">
            {t.group_name && <span>#{t.group_name}</span>}
            {t.debut_at && <span>出道 {t.debut_at.slice(0, 10)}</span>}
          </div>
          <div className="text-sm pt-2">
            共 <b>{products.length}</b> 筆商品記錄
            {totalQty > 0 && <>・總數量 <b>{totalQty}</b></>}
            {totalJpy > 0 && <>・總金額 ¥<b>{totalJpy.toLocaleString()}</b></>}
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold pt-2">我買過的商品</h2>
      {products.length === 0 ? (
        <p className="text-neutral-500 text-sm">尚無記錄。</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {products.map((p, i) => (
            <li key={`${p.order_id}-${p.id}-${i}`} className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 overflow-hidden flex">
              {p.image_url ? (
                <button
                  type="button"
                  onClick={() => setZoomImg(p.image_url!)}
                  className="w-24 h-24 shrink-0 bg-neutral-100 dark:bg-neutral-800 overflow-hidden"
                  title="點擊放大"
                >
                  <img src={p.image_url} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform" loading="lazy" />
                </button>
              ) : (
                <div className="w-24 h-24 shrink-0 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs text-neutral-500">無圖</div>
              )}
              <Link href={`/orders/${p.order_id}`} className="flex-1 min-w-0 p-2 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <div className="font-medium text-sm truncate" title={p.name_ja}>{p.name_ja}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  下單 {p.ordered_at}・×{p.qty}
                  {p.unit_price_jpy ? ` ・¥${p.unit_price_jpy}` : ""}
                </div>
                <div className="text-xs text-neutral-500">
                  {p.received_at ? `✅ 收到 ${p.received_at}` : "☐ 未收到"}
                  {p.release_date && ` ・上架 ${p.release_date}`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {zoomImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomImg(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={zoomImg}
            alt=""
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setZoomImg(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white text-black flex items-center justify-center text-xl shadow"
            aria-label="關閉"
          >×</button>
        </div>
      )}
    </div>
  );
}
