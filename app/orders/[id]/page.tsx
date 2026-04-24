"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Group = { id: string; name_ja: string; name_zh: string | null };
type Talent = { id: string; name_ja: string; name_zh: string | null; group_id: string | null };

type OrderForm = {
  proxy_service: string;
  proxy_order_no: string;
  ordered_at: string;
  received_at: string;
  status: string;
  total_jpy: string;
  proxy_fee_jpy: string;
  shipping_jpy: string;
  total_twd: string;
  exchange_rate: string;
  notes: string;
};

type ItemForm = {
  item_id: string;
  product_id: string;
  name_ja: string;
  name_zh: string;
  image_url: string;
  release_date: string;
  shop_product_code: string;
  qty: string;
  unit_price_jpy: string;
};

function str(v: any) { return v == null ? "" : String(v); }
function toInt(s: string): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
function toFloat(s: string): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export default function EditOrderPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderForm | null>(null);
  const [items, setItems] = useState<ItemForm[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [talents, setTalents] = useState<Talent[]>([]);
  // item_id → [talent_id, ...]
  const [itemTalents, setItemTalents] = useState<Record<string, string[]>>({});
  const [newTalentName, setNewTalentName] = useState<Record<string, string>>({});
  const [newTalentGroup, setNewTalentGroup] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data: o, error: eo } = await supabase
        .from("orders")
        .select("*")
        .eq("id", params.id)
        .single();
      if (eo || !o) { setErr(eo?.message ?? "not found"); setLoading(false); return; }

      const { data: its } = await supabase
        .from("order_items")
        .select("id, qty, unit_price_jpy, product_id, products(id, name_ja, name_zh, image_url, release_date, shop_product_code)")
        .eq("order_id", params.id);

      setOrder({
        proxy_service: str(o.proxy_service),
        proxy_order_no: str(o.proxy_order_no),
        ordered_at: str(o.ordered_at).slice(0, 10),
        received_at: str(o.received_at).slice(0, 10),
        status: str(o.status),
        total_jpy: str(o.total_jpy),
        proxy_fee_jpy: str(o.proxy_fee_jpy),
        shipping_jpy: str(o.shipping_jpy),
        total_twd: str(o.total_twd),
        exchange_rate: str(o.exchange_rate),
        notes: str(o.notes)
      });

      const mapped = (its ?? []).map((r: any) => ({
        item_id: r.id,
        product_id: r.product_id,
        name_ja: str(r.products?.name_ja),
        name_zh: str(r.products?.name_zh),
        image_url: str(r.products?.image_url),
        release_date: str(r.products?.release_date).slice(0, 10),
        shop_product_code: str(r.products?.shop_product_code),
        qty: str(r.qty),
        unit_price_jpy: str(r.unit_price_jpy)
      }));
      setItems(mapped);

      // 載入所有 talents + groups
      const [{ data: gs }, { data: ts }] = await Promise.all([
        supabase.from("groups").select("id, name_ja, name_zh").order("sort_order"),
        supabase.from("talents").select("id, name_ja, name_zh, group_id").order("name_ja")
      ]);
      setGroups((gs ?? []) as Group[]);
      setTalents((ts ?? []) as Talent[]);

      // 各 item 的 linked talents
      if (mapped.length) {
        const pids = mapped.map((m) => m.product_id).filter(Boolean);
        const { data: pts } = await supabase
          .from("product_talents")
          .select("product_id, talent_id")
          .in("product_id", pids);
        const m: Record<string, string[]> = {};
        for (const it of mapped) {
          m[it.item_id] = (pts ?? [])
            .filter((p: any) => p.product_id === it.product_id)
            .map((p: any) => p.talent_id);
        }
        setItemTalents(m);
      }

      setLoading(false);
    })();
  }, [params.id]);

  const linkTalent = async (itemId: string, productId: string, talentId: string) => {
    if (!talentId) return;
    const existing = itemTalents[itemId] || [];
    if (existing.includes(talentId)) return;
    const { error } = await supabase
      .from("product_talents")
      .upsert({ product_id: productId, talent_id: talentId }, { onConflict: "product_id,talent_id" });
    if (error) { setErr(error.message); return; }
    setItemTalents((m) => ({ ...m, [itemId]: [...existing, talentId] }));
  };

  const unlinkTalent = async (itemId: string, productId: string, talentId: string) => {
    const { error } = await supabase
      .from("product_talents")
      .delete()
      .eq("product_id", productId)
      .eq("talent_id", talentId);
    if (error) { setErr(error.message); return; }
    setItemTalents((m) => ({ ...m, [itemId]: (m[itemId] || []).filter((id) => id !== talentId) }));
  };

  const createAndLinkTalent = async (itemId: string, productId: string) => {
    const name = (newTalentName[itemId] || "").trim();
    if (!name) return;
    const groupId = newTalentGroup[itemId] || null;
    // 先看有沒有同名（避免重複）
    const existing = talents.find((t) => t.name_ja === name);
    let talentId: string | null = existing?.id ?? null;
    if (!talentId) {
      const { data, error } = await supabase
        .from("talents")
        .insert({ name_ja: name, group_id: groupId })
        .select("id, name_ja, name_zh, group_id")
        .single();
      if (error || !data) { setErr(error?.message ?? "新增藝人失敗"); return; }
      talentId = data.id;
      setTalents((arr) => [...arr, data as Talent].sort((a, b) => a.name_ja.localeCompare(b.name_ja)));
    }
    if (!talentId) return;
    await linkTalent(itemId, productId, talentId);
    setNewTalentName((m) => ({ ...m, [itemId]: "" }));
    setNewTalentGroup((m) => ({ ...m, [itemId]: "" }));
  };

  const setO = (k: keyof OrderForm, v: string) => setOrder((o) => o ? { ...o, [k]: v } : o);
  const setI = (idx: number, k: keyof ItemForm, v: string) =>
    setItems((arr) => arr.map((it, i) => i === idx ? { ...it, [k]: v } : it));

  const onSave = async () => {
    if (!order) return;
    setSaving(true);
    setErr(null);
    try {
      const { error: eo } = await supabase.from("orders").update({
        proxy_service: order.proxy_service || null,
        proxy_order_no: order.proxy_order_no || null,
        ordered_at: order.ordered_at || null,
        received_at: order.received_at || null,
        status: order.status || null,
        total_jpy: toInt(order.total_jpy),
        proxy_fee_jpy: toInt(order.proxy_fee_jpy) ?? 0,
        shipping_jpy: toInt(order.shipping_jpy) ?? 0,
        total_twd: toInt(order.total_twd),
        exchange_rate: toFloat(order.exchange_rate),
        notes: order.notes || null
      }).eq("id", params.id);
      if (eo) throw eo;

      for (const it of items) {
        const { error: ep } = await supabase.from("products").update({
          name_ja: it.name_ja || "（未命名）",
          name_zh: it.name_zh || null,
          image_url: it.image_url || null,
          release_date: it.release_date || null,
          shop_product_code: it.shop_product_code || null
        }).eq("id", it.product_id);
        if (ep) throw ep;

        const { error: ei } = await supabase.from("order_items").update({
          qty: toInt(it.qty) ?? 1,
          unit_price_jpy: toInt(it.unit_price_jpy)
        }).eq("id", it.item_id);
        if (ei) throw ei;
      }

      router.push("/");
      router.refresh();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const onDeleteItem = async (idx: number) => {
    const it = items[idx];
    if (!confirm(`確定刪除「${it.name_ja}」這一項？`)) return;
    const { error } = await supabase.from("order_items").delete().eq("id", it.item_id);
    if (error) { setErr(error.message); return; }
    setItems((arr) => arr.filter((_, i) => i !== idx));
  };

  const onDeleteOrder = async () => {
    if (!confirm("確定刪除整張訂單？此操作不可還原。")) return;
    // 先刪 order_items（cascade 應該會自動，但保險起見）
    await supabase.from("order_items").delete().eq("order_id", params.id);
    const { error } = await supabase.from("orders").delete().eq("id", params.id);
    if (error) { setErr(error.message); return; }
    router.push("/");
    router.refresh();
  };

  if (loading) return <p>載入中…</p>;
  if (err && !order) return <p className="text-red-600">錯誤：{err}</p>;
  if (!order) return null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">編輯訂單</h1>
        <Link href="/" className="text-sm text-neutral-500 hover:underline">← 返回列表</Link>
      </div>

      <fieldset className="space-y-3 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4">
        <legend className="font-semibold">訂單資訊</legend>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="代購商" v={order.proxy_service} onChange={(v) => setO("proxy_service", v)} />
          <Field label="代購單號" v={order.proxy_order_no} onChange={(v) => setO("proxy_order_no", v)} />
          <Field label="下單日" type="date" v={order.ordered_at} onChange={(v) => setO("ordered_at", v)} />
          <Field label="收件日" type="date" v={order.received_at} onChange={(v) => setO("received_at", v)} />
          <Field label="狀態" v={order.status} onChange={(v) => setO("status", v)} />
          <Field label="匯率 JPY→TWD" v={order.exchange_rate} onChange={(v) => setO("exchange_rate", v)} placeholder="0.2150" />
          <Field label="商品總額 JPY" v={order.total_jpy} onChange={(v) => setO("total_jpy", v)} />
          <Field label="代購手續費 JPY" v={order.proxy_fee_jpy} onChange={(v) => setO("proxy_fee_jpy", v)} />
          <Field label="國際運費 JPY" v={order.shipping_jpy} onChange={(v) => setO("shipping_jpy", v)} />
          <Field label="實付台幣 TWD" v={order.total_twd} onChange={(v) => setO("total_twd", v)} />
        </div>
        <label className="block text-sm">
          <span className="block mb-1">備註</span>
          <textarea
            className="w-full border rounded px-2 py-1 bg-transparent min-h-[60px]"
            value={order.notes}
            onChange={(e) => setO("notes", e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset className="space-y-4 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4">
        <legend className="font-semibold">商品（{items.length} 項）</legend>
        {items.length === 0 && <p className="text-sm text-neutral-500">此訂單沒有商品項目</p>}
        {items.map((it, idx) => (
          <div key={it.item_id} className="border border-neutral-200 dark:border-neutral-800 rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">第 {idx + 1} 件</span>
              <button
                type="button"
                onClick={() => onDeleteItem(idx)}
                className="text-xs text-red-600 hover:underline"
              >
                刪除這件
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="商品名（日文）" v={it.name_ja} onChange={(v) => setI(idx, "name_ja", v)} />
              <Field label="商品名（中文）" v={it.name_zh} onChange={(v) => setI(idx, "name_zh", v)} />
              <Field label="商品代碼" v={it.shop_product_code} onChange={(v) => setI(idx, "shop_product_code", v)} />
              <Field label="上架日" type="date" v={it.release_date} onChange={(v) => setI(idx, "release_date", v)} />
              <Field label="數量" v={it.qty} onChange={(v) => setI(idx, "qty", v)} />
              <Field label="單價 JPY" v={it.unit_price_jpy} onChange={(v) => setI(idx, "unit_price_jpy", v)} />
            </div>
            <Field label="圖片 URL" v={it.image_url} onChange={(v) => setI(idx, "image_url", v)} />
            {it.image_url && (
              <img src={it.image_url} alt="" className="max-h-24 rounded border border-neutral-200 dark:border-neutral-800" />
            )}

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-2 space-y-2">
              <div className="text-xs text-neutral-500">團體 / 藝人（影響首頁團體篩選）</div>
              <div className="flex flex-wrap gap-1 items-center">
                {(itemTalents[it.item_id] || []).map((tid) => {
                  const t = talents.find((x) => x.id === tid);
                  if (!t) return null;
                  const g = groups.find((x) => x.id === t.group_id);
                  return (
                    <span
                      key={tid}
                      className="px-2 py-0.5 text-xs bg-neutral-200 dark:bg-neutral-700 rounded-full flex items-center gap-1"
                    >
                      {t.name_ja}
                      {g && <span className="text-neutral-500">· {g.name_zh ?? g.name_ja}</span>}
                      <button
                        type="button"
                        onClick={() => unlinkTalent(it.item_id, it.product_id, tid)}
                        className="text-neutral-500 hover:text-red-600"
                        title="移除"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                <select
                  className="text-xs border rounded px-1 py-0.5 bg-transparent"
                  value=""
                  onChange={(e) => linkTalent(it.item_id, it.product_id, e.target.value)}
                >
                  <option value="">+ 加藝人</option>
                  {groups.map((g) => {
                    const ts = talents.filter((t) => t.group_id === g.id && !(itemTalents[it.item_id] || []).includes(t.id));
                    if (!ts.length) return null;
                    return (
                      <optgroup key={g.id} label={g.name_zh ?? g.name_ja}>
                        {ts.map((t) => (
                          <option key={t.id} value={t.id}>{t.name_ja}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                  {(() => {
                    const nog = talents.filter((t) => !t.group_id && !(itemTalents[it.item_id] || []).includes(t.id));
                    return nog.length ? (
                      <optgroup label="（未分團）">
                        {nog.map((t) => (
                          <option key={t.id} value={t.id}>{t.name_ja}</option>
                        ))}
                      </optgroup>
                    ) : null;
                  })()}
                </select>
              </div>
              <div className="flex flex-wrap gap-1 items-center">
                <input
                  className="text-xs border rounded px-1 py-0.5 bg-transparent"
                  placeholder="新藝人名（日文）"
                  value={newTalentName[it.item_id] || ""}
                  onChange={(e) => setNewTalentName((m) => ({ ...m, [it.item_id]: e.target.value }))}
                />
                <select
                  className="text-xs border rounded px-1 py-0.5 bg-transparent"
                  value={newTalentGroup[it.item_id] || ""}
                  onChange={(e) => setNewTalentGroup((m) => ({ ...m, [it.item_id]: e.target.value }))}
                >
                  <option value="">（無團體）</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name_zh ?? g.name_ja}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => createAndLinkTalent(it.item_id, it.product_id)}
                  className="text-xs border rounded px-2 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  新增並關聯
                </button>
              </div>
            </div>
          </div>
        ))}
      </fieldset>

      {err && <p className="text-red-600 text-sm whitespace-pre-wrap">{err}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="bg-black text-white dark:bg-white dark:text-black rounded px-4 py-2 disabled:opacity-50"
        >
          {saving ? "儲存中…" : "儲存所有變更"}
        </button>
        <button
          type="button"
          onClick={onDeleteOrder}
          className="border border-red-500 text-red-600 rounded px-4 py-2 hover:bg-red-50 dark:hover:bg-red-950"
        >
          刪除整張訂單
        </button>
      </div>

      <p className="text-xs text-neutral-500">
        ⚠️ 注意：自動同步來源（Gmail/Sheet/letaofun）會在下次同步時覆蓋某些欄位（狀態、備註、金額），如果想永久改動請直接到來源（Sheet / letaofun 後台）改。
      </p>
    </div>
  );
}

function Field(props: {
  label: string;
  v: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="block mb-1">{props.label}</span>
      <input
        className="w-full border rounded px-2 py-1 bg-transparent"
        type={props.type ?? "text"}
        value={props.v}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
    </label>
  );
}
