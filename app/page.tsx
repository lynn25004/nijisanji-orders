"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Row = {
  order_id: string;
  ordered_at: string;
  proxy_service: string | null;
  proxy_order_no: string | null;
  status: string;
  total_jpy: number | null;
  total_twd: number | null;
  product_id: string;
  product_name: string;
  image_url: string | null;
  release_date: string | null;
  qty: number;
  unit_price_jpy: number | null;
  group_id: string | null;
  group_name: string | null;
};

export default function HomePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"ordered_at" | "release_date">("ordered_at");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("order_items")
        .select(`
          qty, unit_price_jpy,
          orders!inner ( id, ordered_at, proxy_service, proxy_order_no, status, total_jpy, total_twd ),
          products!inner (
            id, name_ja, image_url, release_date,
            product_talents ( talents ( group_id, groups ( id, name_ja, name_zh ) ) )
          )
        `);
      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }
      const flat: Row[] = (data ?? []).map((r: any) => {
        const firstGroup = r.products?.product_talents?.[0]?.talents?.groups ?? null;
        return {
          order_id: r.orders.id,
          ordered_at: r.orders.ordered_at,
          proxy_service: r.orders.proxy_service,
          proxy_order_no: r.orders.proxy_order_no,
          status: r.orders.status,
          total_jpy: r.orders.total_jpy,
          total_twd: r.orders.total_twd,
          product_id: r.products.id,
          product_name: r.products.name_ja,
          image_url: r.products.image_url,
          release_date: r.products.release_date,
          qty: r.qty,
          unit_price_jpy: r.unit_price_jpy,
          group_id: firstGroup?.id ?? null,
          group_name: firstGroup?.name_zh ?? firstGroup?.name_ja ?? null
        };
      });
      setRows(flat);
      setLoading(false);
    })();
  }, []);

  const groupOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => {
      if (r.group_id && r.group_name) m.set(r.group_id, r.group_name);
    });
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (groupFilter) list = list.filter((r) => r.group_id === groupFilter);
    list = [...list].sort((a, b) => {
      const av = a[sortBy] ?? "";
      const bv = b[sortBy] ?? "";
      return av < bv ? 1 : av > bv ? -1 : 0;
    });
    return list;
  }, [rows, groupFilter, sortBy]);

  if (loading) return <p>載入中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-sm">
          團體：
          <select
            className="ml-2 border rounded px-2 py-1 bg-transparent"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="">全部</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          排序：
          <select
            className="ml-2 border rounded px-2 py-1 bg-transparent"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
          >
            <option value="ordered_at">下單日期</option>
            <option value="release_date">上架日期</option>
          </select>
        </label>
        <Link
          href="/new"
          className="ml-auto bg-black text-white dark:bg-white dark:text-black rounded px-3 py-1.5 text-sm"
        >
          + 新增訂單
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="text-neutral-500 text-sm">還沒有訂單。點右上 + 新增。</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((r, i) => (
            <li
              key={`${r.order_id}-${r.product_id}-${i}`}
              className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex gap-3 bg-white dark:bg-neutral-900"
            >
              {r.image_url ? (
                <img
                  src={r.image_url}
                  alt=""
                  className="w-20 h-20 object-cover rounded"
                  loading="lazy"
                />
              ) : (
                <div className="w-20 h-20 bg-neutral-200 dark:bg-neutral-800 rounded flex items-center justify-center text-xs text-neutral-500">
                  無圖
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{r.product_name}</div>
                <div className="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-2">
                  {r.group_name && <span>#{r.group_name}</span>}
                  {r.release_date && <span>上架 {r.release_date}</span>}
                </div>
                <div className="text-xs mt-1">
                  下單 {r.ordered_at} · 數量 {r.qty}
                  {r.unit_price_jpy ? ` · ¥${r.unit_price_jpy}` : ""}
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {r.proxy_service ?? "（代購未填）"} · {r.status}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
