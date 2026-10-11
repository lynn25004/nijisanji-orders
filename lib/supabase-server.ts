import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// server-only client (service role bypasses RLS)
let _serverClient: SupabaseClient | null = null;

export function supabaseServer(): SupabaseClient {
  if (_serverClient) return _serverClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars (server).");
  // Next 14 預設會快取 server 端 fetch（Vercel Data Cache 跨部署保留），
  // 不關掉的話 cron 讀到的是舊查詢結果（例：auto-tag 永遠只看到 1 筆待掃商品）
  _serverClient = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return _serverClient;
}
