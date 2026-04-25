"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Wish = {
  id: string;
  name_ja: string;
  shop_product_code: string | null;
  shop_url: string | null;
  image_url: string | null;
  release_date: string | null;
  preorder_start: string | null;
  notes: string | null;
  priority: number;
  talent_ids: string[];
  added_at: string;
  ordered_at: string | null;
};

const PRIORITY_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "必買", color: "bg-red-500 text-white" },
  2: { label: "想要", color: "bg-amber-400 text-black" },
  3: { label: "觀望", color: "bg-neutral-400 text-white" }
};

function extractCode(url: string): string | null {
  // shop.nijisanji.jp/products/XXXX-12345_set1
  const m = url.match(/\/products\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export default function WishlistPage() {
  const [items, setItems] = useState<Wish[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOrdered, setShowOrdered] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // form state
  const [fName, setFName] = useState("");
  const [fUrl, setFUrl] = useState("");
  const [fImg, setFImg] = useState("");
  const [fRelease, setFRelease] = useState("");
  const [fPreorder, setFPreorder] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fPriority, setFPriority] = useState<number>(2);

  const load = async () => {
    const { data, error } = await supabase
      .from("wishlist")
      .select("*")
      .order("priority", { ascending: true })
      .order("added_at", { ascending: false });
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }
    setItems(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setFName("");
    setFUrl("");
    setFImg("");
    setFRelease("");
    setFPreorder("");
    setFNotes("");
    setFPriority(2);
    setEditingId(null);
  };

  const openAdd = () => {
    resetForm();
    setAdding(true);
  };

  const openEdit = (w: Wish) => {
    setFName(w.name_ja);
    setFUrl(w.shop_url ?? "");
    setFImg(w.image_url ?? "");
    setFRelease(w.release_date ?? "");
    setFPreorder(w.preorder_start ?? "");
    setFNotes(w.notes ?? "");
    setFPriority(w.priority);
    setEditingId(w.id);
    setAdding(true);
  };

  const submit = async () => {
    if (!fName.trim()) {
      alert("商品名必填");
      return;
    }
    const payload = {
      name_ja: fName.trim(),
      shop_url: fUrl || null,
      shop_product_code: fUrl ? extractCode(fUrl) : null,
      image_url: fImg || null,
      release_date: fRelease || null,
      preorder_start: fPreorder || null,
      notes: fNotes || null,
      priority: fPriority
    };
    if (editingId) {
      const { error } = await supabase.from("wishlist").update(payload).eq("id", editingId);
      if (error) {
        alert("更新失敗：" + error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("wishlist").insert(payload);
      if (error) {
        alert("新增失敗：" + error.message);
        return;
      }
    }
    setAdding(false);
    resetForm();
    load();
  };

  const markOrdered = async (id: string) => {
    if (!confirm("標記為已下單（會從清單移除）？")) return;
    await supabase.from("wishlist").update({ ordered_at: new Date().toISOString() }).eq("id", id);
    load();
  };

  const restore = async (id: string) => {
    await supabase.from("wishlist").update({ ordered_at: null }).eq("id", id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("確定刪除這筆？")) return;
    await supabase.from("wishlist").delete().eq("id", id);
    load();
  };

  if (loading) {
    return (
      <ul className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <li
            key={i}
            className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex gap-3"
          >
            <div className="w-20 h-20 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const visible = items.filter((w) => (showOrdered ? !!w.ordered_at : !w.ordered_at));
  const activeCount = items.filter((w) => !w.ordered_at).length;
  const orderedCount = items.filter((w) => !!w.ordered_at).length;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold">💭 想買清單</h1>
        <span className="text-sm text-neutral-500">
          活躍 {activeCount} 件 · 已下單 {orderedCount} 件
        </span>
        <button
          onClick={openAdd}
          className="ml-auto bg-black text-white dark:bg-white dark:text-black rounded px-3 py-1.5 text-sm"
        >
          + 加入想買
        </button>
      </div>

      <div className="flex gap-1.5 text-xs">
        <button
          onClick={() => setShowOrdered(false)}
          className={`px-2.5 py-1 rounded-full border ${
            !showOrdered
              ? "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white"
              : "border-neutral-300 dark:border-neutral-700"
          }`}
        >
          活躍 {activeCount}
        </button>
        <button
          onClick={() => setShowOrdered(true)}
          className={`px-2.5 py-1 rounded-full border ${
            showOrdered
              ? "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white"
              : "border-neutral-300 dark:border-neutral-700"
          }`}
        >
          已下單 {orderedCount}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="text-neutral-500 text-sm">
          {showOrdered ? "還沒有從這裡下單成功的紀錄。" : "還沒有想買的東西。點右上「+ 加入想買」開始記錄。"}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((w) => {
            const days = w.release_date
              ? Math.ceil((new Date(w.release_date).getTime() - Date.now()) / 86400000)
              : null;
            const pri = PRIORITY_LABEL[w.priority] ?? PRIORITY_LABEL[2];
            return (
              <li
                key={w.id}
                className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 overflow-hidden flex"
              >
                {w.image_url ? (
                  <img
                    src={w.image_url}
                    alt=""
                    className="w-24 h-24 object-cover shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-24 h-24 bg-neutral-100 dark:bg-neutral-800 shrink-0 flex items-center justify-center text-xs text-neutral-500">
                    無圖
                  </div>
                )}
                <div className="flex-1 min-w-0 p-2.5 space-y-1">
                  <div className="flex items-start gap-2">
                    <div className={`text-xs px-1.5 py-0.5 rounded ${pri.color} shrink-0`}>{pri.label}</div>
                    <div className="font-medium text-sm truncate flex-1" title={w.name_ja}>
                      {w.name_ja}
                    </div>
                  </div>
                  <div className="text-xs text-neutral-500 flex flex-wrap gap-x-2">
                    {w.release_date && (
                      <span className={days !== null && days <= 7 ? "text-amber-600 font-bold" : ""}>
                        上架 {w.release_date}
                        {days !== null && days >= 0 && ` (還有 ${days} 天)`}
                        {days !== null && days < 0 && ` (已過 ${-days} 天)`}
                      </span>
                    )}
                    {w.preorder_start && <span>預訂 {w.preorder_start}</span>}
                  </div>
                  {w.notes && <div className="text-xs text-neutral-600 dark:text-neutral-400 truncate">{w.notes}</div>}
                  <div className="flex gap-1.5 pt-1 text-xs">
                    {w.shop_url && (
                      <a
                        href={w.shop_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 border rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        🔗 商店
                      </a>
                    )}
                    {!w.ordered_at && (
                      <>
                        <button
                          onClick={() => markOrdered(w.id)}
                          className="px-2 py-0.5 border rounded hover:bg-green-100 dark:hover:bg-green-900"
                        >
                          ✅ 已下單
                        </button>
                        <button
                          onClick={() => openEdit(w)}
                          className="px-2 py-0.5 border rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          ✏️ 編輯
                        </button>
                      </>
                    )}
                    {w.ordered_at && (
                      <button
                        onClick={() => restore(w.id)}
                        className="px-2 py-0.5 border rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        ↩ 復原
                      </button>
                    )}
                    <button
                      onClick={() => remove(w.id)}
                      className="px-2 py-0.5 border rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950 ml-auto"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
          onClick={() => setAdding(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-neutral-900 rounded-lg w-full sm:max-w-md p-4 space-y-3 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-lg font-bold">{editingId ? "編輯想買" : "加入想買清單"}</h2>
            <label className="block text-sm">
              商品名 <span className="text-red-500">*</span>
              <input
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                className="w-full border rounded px-2 py-1 mt-1 bg-transparent"
                placeholder="例如：にじさんじ ●●● ぬいぐるみ"
                autoFocus
              />
            </label>
            <label className="block text-sm">
              商店連結（可選，貼 shop URL 自動抽 code）
              <input
                type="url"
                value={fUrl}
                onChange={(e) => setFUrl(e.target.value)}
                className="w-full border rounded px-2 py-1 mt-1 bg-transparent"
                placeholder="https://shop.nijisanji.jp/products/..."
              />
            </label>
            <label className="block text-sm">
              圖片 URL（可選）
              <input
                type="url"
                value={fImg}
                onChange={(e) => setFImg(e.target.value)}
                className="w-full border rounded px-2 py-1 mt-1 bg-transparent"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                上架日
                <input
                  type="date"
                  value={fRelease}
                  onChange={(e) => setFRelease(e.target.value)}
                  className="w-full border rounded px-2 py-1 mt-1 bg-transparent"
                />
              </label>
              <label className="block text-sm">
                預訂開始
                <input
                  type="date"
                  value={fPreorder}
                  onChange={(e) => setFPreorder(e.target.value)}
                  className="w-full border rounded px-2 py-1 mt-1 bg-transparent"
                />
              </label>
            </div>
            <label className="block text-sm">
              優先度
              <select
                value={fPriority}
                onChange={(e) => setFPriority(parseInt(e.target.value, 10))}
                className="w-full border rounded px-2 py-1 mt-1 bg-transparent"
              >
                <option value={1}>必買</option>
                <option value={2}>想要</option>
                <option value={3}>觀望</option>
              </select>
            </label>
            <label className="block text-sm">
              備註（可選）
              <textarea
                value={fNotes}
                onChange={(e) => setFNotes(e.target.value)}
                className="w-full border rounded px-2 py-1 mt-1 bg-transparent"
                rows={2}
              />
            </label>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setAdding(false)}
                className="flex-1 border rounded px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                onClick={submit}
                className="flex-1 bg-black text-white dark:bg-white dark:text-black rounded px-3 py-2"
              >
                {editingId ? "儲存" : "加入"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
