"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Row = {
  order_id: string;
  ordered_at: string;
  received_at: string | null;
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
  talent_ids: string[];
};

export default function HomePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>("");
  const [receivedFilter, setReceivedFilter] = useState<"all" | "yes" | "no">("all");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [proxyFilter, setProxyFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"ordered_at" | "release_date">("ordered_at");
  const [toggling, setToggling] = useState<string | null>(null);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [jpyToTwd, setJpyToTwd] = useState<number>(0.21); // 後備值，會被 API 覆蓋
  const [viewMode, setViewMode] = useState<"list" | "gallery">("list");
  const [activeChip, setActiveChip] = useState<string>("");

  const load = async () => {
    const { data, error } = await supabase
      .from("order_items")
      .select(`
        qty, unit_price_jpy,
        orders!inner ( id, ordered_at, received_at, proxy_service, proxy_order_no, status, total_jpy, total_twd ),
        products!inner (
          id, name_ja, image_url, release_date,
          product_talents ( talents ( id, group_id, groups ( id, name_ja, name_zh ) ) )
        )
      `);
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }
    const flat: Row[] = (data ?? []).map((r: any) => {
      const allTalents = (r.products?.product_talents ?? [])
        .map((pt: any) => pt.talents)
        .filter(Boolean);
      const firstGroup = allTalents[0]?.groups ?? null;
      return {
        order_id: r.orders.id,
        ordered_at: r.orders.ordered_at,
        received_at: r.orders.received_at ?? null,
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
        group_name: firstGroup?.name_zh ?? firstGroup?.name_ja ?? null,
        talent_ids: allTalents.map((t: any) => t.id).filter(Boolean)
      };
    });
    setRows(flat);
    setLoading(false);
  };

  useEffect(() => {
    // 從 URL 還原篩選狀態
    const sp = new URLSearchParams(window.location.search);
    setSearchQuery(sp.get("q") ?? "");
    setGroupFilter(sp.get("group") ?? "");
    setStatusFilter(sp.get("status") ?? "");
    setProxyFilter(sp.get("proxy") ?? "");
    const rec = sp.get("received");
    if (rec === "yes" || rec === "no" || rec === "all") setReceivedFilter(rec);
    const sb = sp.get("sort");
    if (sb === "ordered_at" || sb === "release_date") setSortBy(sb);
    const vm = sp.get("view");
    if (vm === "list" || vm === "gallery") setViewMode(vm);
    const ch = sp.get("chip");
    if (ch) setActiveChip(ch);
    load();
    // 抓今日 JPY→TWD 匯率（24h 內快取）
    (async () => {
      try {
        const cached = localStorage.getItem("jpyToTwd");
        if (cached) {
          const { rate, ts } = JSON.parse(cached);
          if (Date.now() - ts < 86400000) {
            setJpyToTwd(rate);
            return;
          }
        }
        const res = await fetch("https://open.er-api.com/v6/latest/JPY");
        const j = await res.json();
        const rate = j?.rates?.TWD;
        if (typeof rate === "number") {
          setJpyToTwd(rate);
          localStorage.setItem("jpyToTwd", JSON.stringify({ rate, ts: Date.now() }));
        }
      } catch (e) {
        // 失敗就用後備值
      }
    })();
  }, []);

  // 篩選狀態 → URL（不污染歷史）
  useEffect(() => {
    if (loading) return;
    const sp = new URLSearchParams();
    if (searchQuery) sp.set("q", searchQuery);
    if (groupFilter) sp.set("group", groupFilter);
    if (statusFilter) sp.set("status", statusFilter);
    if (proxyFilter) sp.set("proxy", proxyFilter);
    if (receivedFilter !== "all") sp.set("received", receivedFilter);
    if (sortBy !== "ordered_at") sp.set("sort", sortBy);
    if (viewMode !== "list") sp.set("view", viewMode);
    if (activeChip) sp.set("chip", activeChip);
    const qs = sp.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState({}, "", url);
  }, [searchQuery, groupFilter, statusFilter, proxyFilter, receivedFilter, sortBy, viewMode, activeChip, loading]);

  useEffect(() => {
    if (!zoomImg) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomImg(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomImg]);

  const groupOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => {
      if (r.group_id && r.group_name) m.set(r.group_id, r.group_name);
    });
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [rows]);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.status).filter(Boolean)));
  }, [rows]);

  const proxyOptions = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.proxy_service).filter(Boolean) as string[]));
  }, [rows]);

  // 即將上架（已下單未收到 + release_date 還沒到）
  const upcoming = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    return rows
      .filter((r) => !r.received_at && r.release_date && r.release_date >= todayStr)
      .filter((r) => {
        if (seen.has(r.product_id)) return false;
        seen.add(r.product_id);
        return true;
      })
      .sort((a, b) => (a.release_date! < b.release_date! ? -1 : 1))
      .slice(0, 12);
  }, [rows]);

  // 用最近 12 件商品圖做 hero collage 背景
  const heroImages = useMemo(() => {
    const seen = new Set<string>();
    return rows
      .slice()
      .sort((a, b) => (a.ordered_at < b.ordered_at ? 1 : -1))
      .filter((r) => {
        if (!r.image_url || seen.has(r.image_url)) return false;
        seen.add(r.image_url);
        return true;
      })
      .slice(0, 12)
      .map((r) => r.image_url!);
  }, [rows]);

  const daysUntil = (dateStr: string) => {
    const d = new Date(dateStr);
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  };

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisYear = String(now.getFullYear());
    let monthSpend = 0;
    let yearSpend = 0;
    const productIds = new Set<string>();
    const talentIds = new Set<string>();
    for (const r of rows) {
      const amt = (r.unit_price_jpy ?? 0) * r.qty;
      if (r.ordered_at?.startsWith(thisMonth)) monthSpend += amt;
      if (r.ordered_at?.startsWith(thisYear)) yearSpend += amt;
      productIds.add(r.product_id);
      r.talent_ids?.forEach((id) => talentIds.add(id));
    }
    return {
      monthSpend,
      yearSpend,
      productCount: productIds.size,
      talentCount: talentIds.size
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (groupFilter) list = list.filter((r) => r.group_id === groupFilter);
    if (receivedFilter === "yes") list = list.filter((r) => r.received_at);
    if (receivedFilter === "no") list = list.filter((r) => !r.received_at);
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    if (proxyFilter) list = list.filter((r) => r.proxy_service === proxyFilter);
    if (activeChip === "this_month") {
      const now = new Date();
      const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      list = list.filter((r) => r.ordered_at?.startsWith(m));
    }
    if (activeChip === "missing") {
      const todayStr = new Date().toISOString().slice(0, 10);
      list = list.filter((r) => {
        if (r.received_at || !r.release_date) return false;
        const days = (Date.parse(todayStr) - Date.parse(r.release_date)) / 86400000;
        return days > 30;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.product_name?.toLowerCase().includes(q) ||
          r.group_name?.toLowerCase().includes(q) ||
          r.proxy_order_no?.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const av = a[sortBy] ?? "";
      const bv = b[sortBy] ?? "";
      return av < bv ? 1 : av > bv ? -1 : 0;
    });
    return list;
  }, [rows, groupFilter, receivedFilter, statusFilter, proxyFilter, searchQuery, sortBy, activeChip]);

  // 快捷 chip 數字
  const chipCounts = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let unreceived = 0,
      thisMonth = 0,
      missing = 0;
    for (const r of rows) {
      if (!r.received_at) unreceived++;
      if (r.ordered_at?.startsWith(m)) thisMonth++;
      if (!r.received_at && r.release_date) {
        const days = (Date.parse(todayStr) - Date.parse(r.release_date)) / 86400000;
        if (days > 30) missing++;
      }
    }
    return { unreceived, thisMonth, missing };
  }, [rows]);

  // 顏色語意：依狀態 + 是否漏領
  const getStatusStyle = (r: Row) => {
    const status = r.status || "";
    if (status.includes("退款")) {
      return { border: "border-l-4 border-l-neutral-400", strike: true, dot: "bg-neutral-400", label: "已退款" };
    }
    if (status.includes("入庫")) {
      return { border: "border-l-4 border-l-blue-500", strike: false, dot: "bg-blue-500", label: status };
    }
    // 未收到 + 上架日已過 30 天 → 紅色提醒
    if (!r.received_at && r.release_date) {
      const released = new Date(r.release_date);
      const daysSince = (Date.now() - released.getTime()) / 86400000;
      if (daysSince > 30) {
        return { border: "border-l-4 border-l-red-500", strike: false, dot: "bg-red-500", label: "可能漏領" };
      }
    }
    if (!r.received_at) {
      return { border: "border-l-4 border-l-amber-400", strike: false, dot: "bg-amber-400", label: status || "待發貨" };
    }
    return { border: "border-l-4 border-l-green-500", strike: false, dot: "bg-green-500", label: "已收到" };
  };

  const toggleReceived = async (order_id: string) => {
    setToggling(order_id);
    try {
      const res = await fetch("/api/orders/toggle-received", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id })
      });
      const j = await res.json();
      if (!res.ok) {
        alert("更新失敗：" + (j.error || res.status));
      } else {
        // 本地更新
        setRows((prev) =>
          prev.map((r) =>
            r.order_id === order_id ? { ...r, received_at: j.received_at } : r
          )
        );
      }
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3">
              <div className="h-3 w-16 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
              <div className="h-6 w-24 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse mt-2" />
            </div>
          ))}
        </div>
        <div className="h-9 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
        <div className="h-7 w-2/3 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
        <ul className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex gap-3"
            >
              <div className="w-20 h-20 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const totalOrders = new Set(rows.map((r) => r.order_id)).size;
  const receivedOrders = new Set(rows.filter((r) => r.received_at).map((r) => r.order_id)).size;

  return (
    <div className="space-y-4">
      {heroImages.length > 0 && (
        <div className="relative -mx-4 sm:mx-0 sm:rounded-lg overflow-hidden h-32 sm:h-40">
          <div className="absolute inset-0 grid grid-cols-6 sm:grid-cols-12 gap-px opacity-40 dark:opacity-25">
            {heroImages.map((src, i) => (
              <div key={i} className="bg-neutral-300 dark:bg-neutral-700 overflow-hidden">
                <img src={src} alt="" className="w-full h-full object-cover blur-[1px]" loading="lazy" />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-white/30 via-white/60 to-white dark:from-black/30 dark:via-black/60 dark:to-black" />
          <div className="relative h-full flex flex-col justify-end p-4">
            <h1 className="text-2xl sm:text-3xl font-bold drop-shadow-sm">🛍️ 我的彩虹社</h1>
            <p className="text-xs sm:text-sm text-neutral-600 dark:text-neutral-300">
              {stats.productCount} 件 · {stats.talentCount} 位推 · 今年花了 ¥{stats.yearSpend.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 bg-white dark:bg-neutral-900">
          <div className="text-xs text-neutral-500">本月支出</div>
          <div className="text-xl font-bold mt-0.5">¥{stats.monthSpend.toLocaleString()}</div>
          <div className="text-xs text-neutral-500 mt-0.5">≈ NT${Math.round(stats.monthSpend * jpyToTwd).toLocaleString()}</div>
        </div>
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 bg-white dark:bg-neutral-900">
          <div className="text-xs text-neutral-500">今年累積</div>
          <div className="text-xl font-bold mt-0.5">¥{stats.yearSpend.toLocaleString()}</div>
          <div className="text-xs text-neutral-500 mt-0.5">≈ NT${Math.round(stats.yearSpend * jpyToTwd).toLocaleString()}</div>
        </div>
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 bg-white dark:bg-neutral-900">
          <div className="text-xs text-neutral-500">商品數</div>
          <div className="text-xl font-bold mt-0.5">
            {stats.productCount}
            <span className="text-xs text-neutral-500 font-normal ml-1">件</span>
          </div>
        </div>
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 bg-white dark:bg-neutral-900">
          <div className="text-xs text-neutral-500">涵蓋成員</div>
          <div className="text-xl font-bold mt-0.5">
            {stats.talentCount}
            <span className="text-xs text-neutral-500 font-normal ml-1">位</span>
          </div>
        </div>
      </div>

      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">
            ⏰ 即將上架（已下單未到 {upcoming.length} 件）
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
            {upcoming.map((r) => {
              const days = daysUntil(r.release_date!);
              const urgent = days <= 7;
              return (
                <Link
                  key={r.product_id}
                  href={`/orders/${r.order_id}`}
                  className={`shrink-0 w-32 border rounded-lg overflow-hidden bg-white dark:bg-neutral-900 hover:shadow ${
                    urgent ? "border-amber-400" : "border-neutral-200 dark:border-neutral-800"
                  }`}
                >
                  {r.image_url ? (
                    <img src={r.image_url} alt="" className="w-full h-20 object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-20 bg-neutral-200 dark:bg-neutral-800" />
                  )}
                  <div className="p-2">
                    <div className="text-xs font-medium truncate" title={r.product_name}>
                      {r.product_name}
                    </div>
                    <div className={`text-xs mt-0.5 font-bold ${urgent ? "text-amber-600 dark:text-amber-400" : "text-neutral-500"}`}>
                      還有 {days} 天
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 快捷篩選 chip */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {[
          { key: "", label: "全部", count: rows.length },
          { key: "unreceived", label: "未收到", count: chipCounts.unreceived },
          { key: "this_month", label: "本月", count: chipCounts.thisMonth },
          { key: "missing", label: "可能漏領", count: chipCounts.missing }
        ].map((c) => {
          const active = activeChip === c.key || (c.key === "" && !activeChip);
          return (
            <button
              key={c.key || "all"}
              onClick={() => {
                if (c.key === "unreceived") {
                  setActiveChip("");
                  setReceivedFilter("no");
                } else {
                  setActiveChip(c.key);
                  if (c.key === "") setReceivedFilter("all");
                }
              }}
              className={`px-2.5 py-1 rounded-full border transition-colors ${
                active
                  ? "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white"
                  : "border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              #{c.label} <span className="opacity-60">{c.count}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="search"
            placeholder="🔍 搜商品名 / 成員 / 訂單號"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-[200px] border rounded px-3 py-1.5 text-sm bg-transparent"
          />
          <div className="flex border rounded overflow-hidden text-sm">
            <button
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1.5 ${viewMode === "list" ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              title="列表"
            >📋</button>
            <button
              onClick={() => setViewMode("gallery")}
              className={`px-2.5 py-1.5 ${viewMode === "gallery" ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              title="圖牆"
            >🖼</button>
          </div>
          <Link
            href="/new"
            className="bg-black text-white dark:bg-white dark:text-black rounded px-3 py-1.5 text-sm whitespace-nowrap"
          >
            + 新增訂單
          </Link>
        </div>
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <label>
            團體：
            <select
              className="ml-1 border rounded px-2 py-1 bg-transparent"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="">全部</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label>
            收件：
            <select
              className="ml-1 border rounded px-2 py-1 bg-transparent"
              value={receivedFilter}
              onChange={(e) => setReceivedFilter(e.target.value as any)}
            >
              <option value="all">全部</option>
              <option value="no">未收到</option>
              <option value="yes">已收到</option>
            </select>
          </label>
          <label>
            狀態：
            <select
              className="ml-1 border rounded px-2 py-1 bg-transparent"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">全部</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            代購：
            <select
              className="ml-1 border rounded px-2 py-1 bg-transparent"
              value={proxyFilter}
              onChange={(e) => setProxyFilter(e.target.value)}
            >
              <option value="">全部</option>
              {proxyOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            排序：
            <select
              className="ml-1 border rounded px-2 py-1 bg-transparent"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="ordered_at">下單日期</option>
              <option value="release_date">上架日期</option>
            </select>
          </label>
          <span className="text-neutral-500 ml-auto">
            {filtered.length === rows.length
              ? `${receivedOrders}/${totalOrders} 訂單已收到`
              : `符合條件 ${filtered.length} 件 · ${receivedOrders}/${totalOrders} 已收到`}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-neutral-500 text-sm">沒有符合條件的訂單。</p>
      ) : viewMode === "gallery" ? (
        <ul className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
          {filtered.map((r, i) => {
            const sty = getStatusStyle(r);
            return (
              <li key={`g-${r.order_id}-${r.product_id}-${i}`} className="relative aspect-square group">
                <Link href={`/orders/${r.order_id}`} className="block w-full h-full bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden">
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt={r.product_name}
                      className="w-full h-full object-cover hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-neutral-500 p-2 text-center">
                      {r.product_name}
                    </div>
                  )}
                </Link>
                <span
                  className={`absolute top-1 right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-neutral-900 ${sty.dot}`}
                  title={sty.label}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="text-white text-xs truncate">{r.product_name}</div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((r, i) => {
            const sty = getStatusStyle(r);
            return (
            <li
              key={`${r.order_id}-${r.product_id}-${i}`}
              className={`border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 overflow-hidden ${sty.border}`}
            >
              <div className="p-3 flex gap-3">
                {r.image_url ? (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setZoomImg(r.image_url!); }}
                    className="shrink-0"
                    title="點擊放大"
                  >
                    <img
                      src={r.image_url}
                      alt=""
                      className="w-20 h-20 object-cover rounded hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  </button>
                ) : (
                  <div className="w-20 h-20 bg-neutral-200 dark:bg-neutral-800 rounded flex items-center justify-center text-xs text-neutral-500">
                    無圖
                  </div>
                )}
                <Link
                  href={`/orders/${r.order_id}`}
                  className="flex-1 min-w-0 hover:bg-neutral-50 dark:hover:bg-neutral-800 -m-1 p-1 rounded transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className={`font-medium truncate flex-1 ${sty.strike ? "line-through text-neutral-400" : ""}`}>{r.product_name}</div>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleReceived(r.order_id); }}
                      disabled={toggling === r.order_id}
                      title={r.received_at ? `已收到 ${r.received_at}（點擊取消）` : "標記已收到"}
                      className={
                        "shrink-0 text-xs px-2 py-0.5 rounded border " +
                        (r.received_at
                          ? "bg-green-600 text-white border-green-600"
                          : "bg-transparent border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800") +
                        (toggling === r.order_id ? " opacity-50" : "")
                      }
                    >
                      {r.received_at ? "✅ 已收到" : "☐ 未收到"}
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-2">
                    {r.group_name && <span>#{r.group_name}</span>}
                    {r.release_date && <span>上架 {r.release_date}</span>}
                  </div>
                  <div className="text-xs mt-1">
                    下單 {r.ordered_at} · 數量 {r.qty}
                    {r.unit_price_jpy ? ` · ¥${r.unit_price_jpy}` : ""}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${sty.dot}`} aria-hidden />
                    <span>{sty.label}</span>
                    <span>· {r.proxy_service ?? "（代購未填）"}</span>
                    {r.received_at && <span>· 收到於 {r.received_at}</span>}
                  </div>
                </Link>
              </div>
            </li>
            );
          })}
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
