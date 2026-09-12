import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductKeyColumn = "shop_url" | "shop_product_code";

export type ProductFields = {
  name_ja: string;
  name_zh?: string | null;
  image_url?: string | null;
  list_price_jpy?: number | null;
  release_date?: string | null;
  shop_url?: string | null;
  shop_product_code?: string | null;
};

export type ProductUpsertResult = {
  id: string | null;
  created: boolean;
  /** 撞到 unique constraint、改讀既有那筆（代表有另一個 run 同時在寫） */
  raced: boolean;
  error: string | null;
};

function isUniqueViolation(err: any): boolean {
  return (
    err?.code === "23505" ||
    /duplicate key value|unique constraint/i.test(err?.message || "")
  );
}

/**
 * 以 shop_url 或 shop_product_code 當唯一鍵，取得既有 product 或新增一筆。
 *
 * select→insert 中間如果有另一個 cron run 搶先插入（GitHub Actions 重跑、
 * 手動 dispatch 撞排程），insert 會噴 products_shop_url_key / idx_products_code。
 * 這裡把該錯誤視為「已存在」，回頭再 select 一次拿 id，而不是報成失敗。
 */
export async function getOrCreateProduct(
  sb: SupabaseClient,
  key: { column: ProductKeyColumn; value: string },
  fields: ProductFields
): Promise<ProductUpsertResult> {
  const find = async (): Promise<string | null> => {
    const { data } = await sb
      .from("products")
      .select("id")
      .eq(key.column, key.value)
      .limit(1)
      .maybeSingle();
    return (data as any)?.id ?? null;
  };

  const existing = await find();
  if (existing) return { id: existing, created: false, raced: false, error: null };

  const { data: created, error } = await sb
    .from("products")
    .insert({ ...fields, [key.column]: key.value })
    .select("id")
    .single();
  if (!error && created) {
    return { id: (created as any).id, created: true, raced: false, error: null };
  }

  if (isUniqueViolation(error)) {
    const again = await find();
    if (again) return { id: again, created: false, raced: true, error: null };
  }

  return {
    id: null,
    created: false,
    raced: false,
    error: error?.message || "product insert failed"
  };
}
