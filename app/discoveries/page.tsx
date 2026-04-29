"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Discovery = {
  id: string;
  shop_product_code: string;
  shop_url: string | null;
  name_ja: string;
  image_url: string | null;
  price_jpy: number | null;
  talent_ids: string[];
  has_order: boolean;
  discovered_at: string;
  notified_at: string | null;
};

type Talent = { id: string; name_ja: string | null; name_en: string | null };

type SearchHist = {
  id: string;
  query: string;
  hit_count: number;
  last_searched_at: string;
};

type Filter = "all" | "subscribed" | "new7d";

export default function DiscoveriesPage() {
  const [rows, setRows] = useState<Discovery[]>([]);
  const [talents, setTalents] = useState<Talent[]>([]);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const [wishedCodes, setWishedCodes] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("subscribed");
  const [loading, setLoading] = useState(true);
  const [searchHist, setSearchHist] = useState<SearchHist[]>([]);

  const loadSearchHist = async () => {
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data } = await supabase
      .from("search_history")
      .select("id, query, hit_count, last_searched_at")
      .gte("last_searched_at", cutoff)
      .gte("hit_count", 2)
      .order("last_searched_at", { ascending: false })
      .limit(20);
    setSearchHist((data || []) as SearchHist[]);
  };

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: t }, { data: pt }, { data: w }] =
        await Promise.all([
          supabase
            .from("discovered_products")
            .select("*")
            .order("discovered_at", { ascending: false })
            .limit(200),
          supabase.from("talents").select("id, name_ja, name_en"),
          supabase.from("product_talents").select("talent_id"),
          supabase
            .from("wishlist")
            .select("shop_product_code")
            .is("ordered_at", null)
        ]);
      setRows((d || []) as Discovery[]);
      setTalents((t || []) as Talent[]);
      setSubscribed(new Set((pt || []).map((r: any) => r.talent_id)));
      setWishedCodes(
        new Set(
          (w || [])
            .map((r: any) => r.shop_product_code)
            .filter(Boolean) as string[]
        )
      );
      setLoading(false);
    })();
    loadSearchHist();
  }, []);

  const openLetaoSearch = (q: string) => {
    const target =
      "https://mall.letaofun.com/static/html/pc.html" +
      "#/subPackages/search/search/index?searchValue=" +
      encodeURIComponent(q) +
      "&transfer=1";
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const removeSearchHist = async (id: string) => {
    setSearchHist((prev) => prev.filter((s) => s.id !== id));
    await supabase.from("search_history").delete().eq("id", id);
  };

  const LETAO_BASE = "https://mall.letaofun.com/static/html/pc.html";

  const openLetao = async (code: string | null, url: string | null) => {
    let target: string;
    if (code) {
      target =
        LETAO_BASE +
        "#/subPackages/pagesOther/goods_details/template?id=" +
        encodeURIComponent(code) +
        "&siteValue=NIJISANJI";
    } else if (url) {
      target =
        LETAO_BASE +
        "#/subPackages/pages/purchasingAgent/fill_in_info/index?url=" +
        encodeURIComponent(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {}
    } else {
      target =
        LETAO_BASE + "#/subPackages/pagesOther/template_based/index";
    }
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const addToWishlist = async (r: Discovery) => {
    setAdding(r.id);
    const { error } = await supabase.from("wishlist").insert({
      name_ja: r.name_ja,
      shop_product_code: r.shop_product_code,
      shop_url: r.shop_url,
      image_url: r.image_url,
      talent_ids: r.talent_ids,
      priority: 2
    });
    setAdding(null);
    if (error) {
      alert("加入失敗：" + error.message);
      return;
    }
    setWishedCodes((prev) => new Set(prev).add(r.shop_product_code));
  };

  const talentMap = useMemo(() => {
    const m = new Map<string, string>();
    talents.forEach((t) => m.set(t.id, t.name_ja || t.name_en || "?"));
    return m;
  }, [talents]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      if (filter === "subscribed") {
        return r.talent_ids.some((id) => subscribed.has(id));
      }
      if (filter === "new7d") {
        return now - new Date(r.discovered_at).getTime() < 7 * 86400_000;
      }
      return true;
    });
  }, [rows, filter, subscribed]);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      all: rows.length,
      subscribed: rows.filter((r) =>
        r.talent_ids.some((id) => subscribed.has(id))
      ).length,
      new7d: rows.filter(
        (r) => now - new Date(r.discovered_at).getTime() < 7 * 86400_000
      ).length
    };
  }, [rows, subscribed]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">🆕 上架雷達</h1>
        <p className="text-sm text-neutral-500">載入中…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold">🆕 上架雷達</h1>
        <span className="text-xs text-neutral-500">
          shop.nijisanji.jp 每天自動掃描，命中你常買的成員會推 Telegram
        </span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(
          [
            ["subscribed", `我的成員 ${counts.subscribed}`],
            ["new7d", `最近 7 天 ${counts.new7d}`],
            ["all", `全部 ${counts.all}`]
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={
              "px-3 py-1.5 rounded-full text-sm border transition " +
              (filter === key
                ? "bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white"
                : "bg-transparent border-neutral-300 hover:border-neutral-500 dark:border-neutral-700")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {searchHist.length > 0 && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2.5 bg-neutral-50 dark:bg-neutral-900/50">
          <div className="text-xs text-neutral-500 mb-1.5">
            🔍 你最近搜過的關鍵字（雷達會幫你監看，點 🛒 跳樂淘搜尋）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {searchHist.map((s) => (
              <span
                key={s.id}
                className="group inline-flex items-center gap-1 text-xs bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-full pl-2.5 pr-1 py-0.5"
              >
                <span title={`搜過 ${s.hit_count} 次`}>{s.query}</span>
                <button
                  type="button"
                  onClick={() => openLetaoSearch(s.query)}
                  title="樂淘搜尋這個詞"
                  className="px-1 hover:text-sky-600"
                >
                  🛒
                </button>
                <button
                  type="button"
                  onClick={() => removeSearchHist(s.id)}
                  title="從紀錄移除"
                  className="px-1 text-neutral-400 hover:text-red-500"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-neutral-500 text-sm">
          {filter === "subscribed"
            ? "你常買的成員目前沒有新上架商品"
            : "沒有符合的商品"}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.map((r) => {
            const isHit = r.talent_ids.some((id) => subscribed.has(id));
            const wished = wishedCodes.has(r.shop_product_code);
            const ageDays = Math.floor(
              (Date.now() - new Date(r.discovered_at).getTime()) / 86400_000
            );
            return (
              <div
                key={r.id}
                className="group block rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800 hover:shadow-lg transition bg-white dark:bg-neutral-900 flex flex-col"
              >
                <a
                  href={r.shop_url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                <div className="aspect-square bg-neutral-100 dark:bg-neutral-800 relative">
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.image_url}
                      alt={r.name_ja}
                      className="w-full h-full object-cover group-hover:scale-105 transition"
                    />
                  ) : null}
                  <div className="absolute top-1 left-1 flex gap-1 flex-wrap">
                    {ageDays <= 1 && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-red-600 text-white rounded">
                        NEW
                      </span>
                    )}
                    {isHit && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-pink-600 text-white rounded">
                        我的推
                      </span>
                    )}
                    {r.has_order && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-emerald-600 text-white rounded">
                        已買
                      </span>
                    )}
                    {wished && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-amber-500 text-white rounded">
                        想買中
                      </span>
                    )}
                  </div>
                </div>
                </a>
                <div className="p-2 space-y-1 flex-1 flex flex-col">
                  <div className="text-xs line-clamp-2 leading-snug min-h-[2.4em]">
                    {r.name_ja}
                  </div>
                  <div className="flex items-baseline justify-between">
                    {r.price_jpy ? (
                      <span className="text-sm font-bold">
                        ¥{r.price_jpy.toLocaleString()}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="text-[10px] text-neutral-500">
                      {ageDays === 0 ? "今天" : `${ageDays}d`}
                    </span>
                  </div>
                  {r.talent_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.talent_ids.slice(0, 3).map((id) => (
                        <span
                          key={id}
                          className={
                            "text-[10px] px-1.5 py-0.5 rounded " +
                            (subscribed.has(id)
                              ? "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-200"
                              : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400")
                          }
                        >
                          {talentMap.get(id) || "?"}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => addToWishlist(r)}
                      disabled={wished || adding === r.id || r.has_order}
                      className={
                        "text-xs py-1 rounded border transition " +
                        (wished
                          ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 cursor-default"
                          : r.has_order
                          ? "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 cursor-default"
                          : adding === r.id
                          ? "opacity-50 border-neutral-300"
                          : "border-neutral-300 dark:border-neutral-700 hover:bg-pink-50 hover:border-pink-300 dark:hover:bg-pink-950")
                      }
                    >
                      {wished
                        ? "✓ 想買"
                        : r.has_order
                        ? "✓ 已買"
                        : adding === r.id
                        ? "加入中…"
                        : "+ 想買"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openLetao(r.shop_product_code, r.shop_url)}
                      title="複製連結並開樂淘代購單"
                      className="text-xs py-1 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-sky-50 hover:border-sky-300 dark:hover:bg-sky-950"
                    >
                      🛒 樂淘
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-4 text-xs text-neutral-500 text-center">
        <Link href="/" className="hover:underline">
          ← 回訂單
        </Link>
      </div>
    </div>
  );
}
