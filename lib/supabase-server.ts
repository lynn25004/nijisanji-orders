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
  _serverClient = createClient(url, key, { auth: { persistSession: false } });
  return _serverClient;
}
