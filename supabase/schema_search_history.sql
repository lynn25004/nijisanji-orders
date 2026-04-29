-- 首頁搜尋紀錄：debounce 1.5s 寫入，cron 用最近 30 天且 ≥2 次的關鍵字去搜 shop

create table if not exists search_history (
  id uuid primary key default gen_random_uuid(),
  query text not null unique,
  hit_count integer not null default 1,
  last_searched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_search_history_recent on search_history(last_searched_at desc);
create index if not exists idx_search_history_active
  on search_history(hit_count desc, last_searched_at desc)
  where hit_count >= 2;

alter table search_history enable row level security;

drop policy if exists "anon_all" on search_history;
create policy "anon_all" on search_history
  for all to anon, authenticated
  using (true) with check (true);
