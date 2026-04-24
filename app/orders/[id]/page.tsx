"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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

      setItems((its ?? []).map((r: any) => ({
        item_id: r.id,
        product_id: r.product_id,
        name_ja: str(r.products?.name_ja),
        name_zh: str(r.products?.name_zh),
        image_url: str(r.products?.image_url),
        release_date: str(r.products?.release_date).slice(0, 10),
        shop_product_code: str(r.products?.shop_product_code),
        qty: str(r.qty),
        unit_price_jpy: str(r.unit_price_jpy)
      })));
      setLoading(false);
    })();
  }, [params.id]);

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
