-- =====================================================================
-- v12: 一人多團 — group_members（成員 ↔ 團體 多對多）
-- =====================================================================
-- talents.group_id 保留當「主團體」（出道同期 / 出道 unit），
-- 另外的組合（ROF-MAO、ChroNoiR、Nornis、さんばか…）放 group_members。
--
--   - is_primary = true 那筆永遠跟 talents.group_id 同步（trigger 維護）
--   - 其餘列 = 額外組合，手動 / 腳本維護
--
-- 整份 idempotent，重跑沒副作用。
-- =====================================================================

begin;

create table if not exists group_members (
  talent_id   uuid not null references talents(id) on delete cascade,
  group_id    uuid not null references groups(id)  on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz default now(),
  primary key (talent_id, group_id)
);

create index if not exists group_members_group_idx on group_members (group_id);

alter table group_members disable row level security;
grant select, insert, update, delete on group_members to anon, authenticated, service_role;

-- 回填：現有主團體
insert into group_members (talent_id, group_id, is_primary)
select id, group_id, true from talents where group_id is not null
on conflict (talent_id, group_id) do update set is_primary = true;

-- talents.group_id 變動時同步主團體那一列
create or replace function sync_primary_group_member()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' and OLD.group_id is distinct from NEW.group_id and OLD.group_id is not null then
    delete from group_members
     where talent_id = NEW.id and group_id = OLD.group_id and is_primary;
  end if;
  if NEW.group_id is not null then
    insert into group_members (talent_id, group_id, is_primary)
    values (NEW.id, NEW.group_id, true)
    on conflict (talent_id, group_id) do update set is_primary = true;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_primary_group_member on talents;
create trigger trg_sync_primary_group_member
after insert or update of group_id on talents
for each row
execute function sync_primary_group_member();

commit;

-- 驗證：每個有 group_id 的成員都該有一筆 is_primary（應回 0 列）
select t.name_ja
from talents t
where t.group_id is not null
  and not exists (
    select 1 from group_members m
     where m.talent_id = t.id and m.group_id = t.group_id and m.is_primary
  );
