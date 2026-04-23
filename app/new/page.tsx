"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Group } from "@/lib/types";

export default function NewOrderPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    proxy_service: "Buyee",
    proxy_order_no: "",
    ordered_at: new Date().toISOString().slice(0, 10),
    total_jpy: "",
    total_twd: "",
    proxy_fee_jpy: "",
    shipping_jpy: "",
    status: "ordered",
    notes: "",
    product_name_ja: "",
    product_shop_url: "",
    product_image_url: "",
    product_release_date: "",
    product_list_price_jpy: "",
    group_id: "",
    qty: "1",
    unit_price_jpy: ""
  });

  useEffect(() => {
    supabase
      .from("groups")
      .select("*")
      .order("sort_order")
      .then(({ data }) => setGroups((data ?? []) as Group[]));
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);

    try {
      // 1) upsert product
      let productId: string | null = null;
      if (form.product_shop_url) {
        const { data: existing } = await supabase
          .from("products")
          .select("id")
          .eq("shop_url", form.product_shop_url)
          .maybeSingle();
        if (existing) productId = existing.id;
      }
      if (!productId) {
        const { data: p, error: ep } = await supabase
          .from("products")
          .insert({
            shop_url: form.product_shop_url || null,
            name_ja: form.product_name_ja,
            image_url: form.product_image_url || null,
            release_date: form.product_release_date || null,
            list_price_jpy: toInt(form.product_list_price_jpy)
          })
          .select("id")
          .single();
        if (ep) throw ep;
        productId = p!.id;
      }

      // 2) 若指定團體 → 建虛擬 talent 並綁定（簡化：團體當一個 talent）
      if (form.group_id) {
        const placeholderName = `__group_${form.group_id.slice(0, 8)}`;
        let { data: t } = await supabase
          .from("talents")
          .select("id")
          .eq("name_ja", placeholderName)
          .maybeSingle();
        if (!t) {
          const { data: nt } = await supabase
            .from("talents")
            .insert({ name_ja: placeholderName, group_id: form.group_id })
            .select("id")
            .single();
          t = nt!;
        }
        await supabase
          .from("product_talents")
          .upsert({ product_id: productId, talent_id: t.id });
      }

      // 3) 建立 order
      const { data: o, error: eo } = await supabase
        .from("orders")
        .insert({
          proxy_service: form.proxy_service || null,
          proxy_order_no: form.proxy_order_no || null,
          ordered_at: form.ordered_at,
          status: form.status,
          total_jpy: toInt(form.total_jpy),
          total_twd: toInt(form.total_twd),
          proxy_fee_jpy: toInt(form.proxy_fee_jpy) ?? 0,
          shipping_jpy: toInt(form.shipping_jpy) ?? 0,
          notes: form.notes || null
        })
        .select("id")
        .single();
      if (eo) throw eo;

      // 4) 建立 order_item
      const { error: ei } = await supabase.from("order_items").insert({
        order_id: o!.id,
        product_id: productId,
        qty: toInt(form.qty) ?? 1,
        unit_price_jpy: toInt(form.unit_price_jpy)
      });
      if (ei) throw ei;

      router.push("/");
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold">新增訂單</h1>

      <fieldset className="space-y-3 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4">
        <legend className="font-semibold">代購資訊</legend>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="代購商" v={form.proxy_service} onChange={(v) => set("proxy_service", v)} />
          <Field label="代購單號" v={form.proxy_order_no} onChange={(v) => set("proxy_order_no", v)} />
          <Field label="下單日" type="date" v={form.ordered_at} onChange={(v) => set("ordered_at", v)} />
          <Select
            label="狀態"
            v={form.status}
            onChange={(v) => set("status", v)}
            options={["ordered", "paid", "shipped", "delivered", "cancelled"]}
          />
          <Field label="商品總額 JPY" v={form.total_jpy} onChange={(v) => set("total_jpy", v)} />
          <Field label="代購手續費 JPY" v={form.proxy_fee_jpy} onChange={(v) => set("proxy_fee_jpy", v)} />
          <Field label="國際運費 JPY" v={form.shipping_jpy} onChange={(v) => set("shipping_jpy", v)} />
          <Field label="實付台幣 TWD" v={form.total_twd} onChange={(v) => set("total_twd", v)} />
        </div>
        <Field label="備註" v={form.notes} onChange={(v) => set("notes", v)} />
      </fieldset>

      <fieldset className="space-y-3 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4">
        <legend className="font-semibold">商品（第一件）</legend>
        <Field label="日文商品名 *" v={form.product_name_ja} onChange={(v) => set("product_name_ja", v)} required />
        <Field
          label="shop.nijisanji.jp 連結"
          v={form.product_shop_url}
          onChange={(v) => set("product_shop_url", v)}
          placeholder="https://shop.nijisanji.jp/products/..."
        />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="封面圖 URL" v={form.product_image_url} onChange={(v) => set("product_image_url", v)} />
          <Field label="上架日" type="date" v={form.product_release_date} onChange={(v) => set("product_release_date", v)} />
          <Field label="官方定價 JPY" v={form.product_list_price_jpy} onChange={(v) => set("product_list_price_jpy", v)} />
          <Select
            label="團體"
            v={form.group_id}
            onChange={(v) => set("group_id", v)}
            options={[["", "—"], ...groups.map((g) => [g.id, g.name_zh ?? g.name_ja] as [string, string])]}
          />
          <Field label="數量" v={form.qty} onChange={(v) => set("qty", v)} />
          <Field label="下單單價 JPY" v={form.unit_price_jpy} onChange={(v) => set("unit_price_jpy", v)} />
        </div>
      </fieldset>

      {err && <p className="text-red-600 text-sm whitespace-pre-wrap">{err}</p>}

      <button
        type="submit"
        disabled={saving}
        className="bg-black text-white dark:bg-white dark:text-black rounded px-4 py-2 disabled:opacity-50"
      >
        {saving ? "儲存中…" : "儲存訂單"}
      </button>
    </form>
  );
}

function toInt(s: string): number | null {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function Field(props: {
  label: string;
  v: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
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
        required={props.required}
      />
    </label>
  );
}

function Select(props: {
  label: string;
  v: string;
  onChange: (v: string) => void;
  options: (string | [string, string])[];
}) {
  return (
    <label className="block text-sm">
      <span className="block mb-1">{props.label}</span>
      <select
        className="w-full border rounded px-2 py-1 bg-transparent"
        value={props.v}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) => {
          const [val, lbl] = Array.isArray(o) ? o : [o, o];
          return <option key={val} value={val}>{lbl}</option>;
        })}
      </select>
    </label>
  );
}
