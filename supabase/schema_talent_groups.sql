-- =====================================================================
-- v11_full: にじさんじ 成員「期数 / 組合」分組 + 新成員自動分組 trigger
-- =====================================================================
-- 來源：にじさんじ Wiki* (wikiwiki.jp/nijisanji)「公式ライバー」頁
--
-- 本檔做的事：
--   0) 修掉 groups.name_ja 可能存在的重複資料（避免 21000 錯誤）
--      並加上 unique index 防止以後再爆
--   1) 補齊缺少的 groups（月組 + 單位）
--   2) 指派 talents.group_id：
--        - 有官方/常用單位（VΔLZ、Nornis、ROF-MAO、すぷれあ…）優先
--        - 否則用該成員出道日所屬的「○年○月～○月組」
--   3) 建立 trigger：之後 import-talents 掃進來的新成員，
--      沒指定 group_id 時依 debut_at 自動歸到「○年○月組」，
--      手動指定的團體一律保留，不會被覆寫
--   4) 驗證查詢
--
-- 整份 idempotent，重跑沒副作用。
-- =====================================================================

begin;

-- =====================================================================
-- 0) 清掉 groups.name_ja 可能的重複，並加 unique index
-- =====================================================================
-- 對每個重複的 name_ja，挑 ctid 最小（最早建立）那筆當 keeper，
-- 把 talents.group_id 從非 keeper 全部改指到 keeper，再刪除重複 group。
with ranked as (
  select
    id,
    name_ja,
    row_number() over (partition by name_ja order by ctid) as rn
  from groups
),
keepers as (
  select name_ja, id as keeper_id from ranked where rn = 1
),
dups as (
  select r.id as dup_id, k.keeper_id
  from ranked r
  join keepers k on k.name_ja = r.name_ja
  where r.rn > 1
),
moved as (
  update talents t
     set group_id = d.keeper_id
    from dups d
   where t.group_id = d.dup_id
  returning t.id
)
delete from groups g
using dups d
where g.id = d.dup_id;

-- 加 unique，未來重跑也安全
create unique index if not exists groups_name_ja_uniq on groups (name_ja);


-- =====================================================================
-- 1) 新增缺少的 groups
-- =====================================================================
insert into groups (name_ja, name_zh, sort_order)
select v.name_ja, v.name_zh, v.sort_order
from (values
  ('2019年1月～3月組',     '2019年1～3月組',       150),
  ('2019年4月～6月組',     '2019年4～6月組',       160),
  ('2019年7月～9月組',     '2019年7～9月組',       170),
  ('2019年10月～12月組',   '2019年10～12月組',     180),
  ('2020年1月組',          '2020年1月組',           190),
  ('2020年6月組',          '2020年6月組',           210),
  ('2022年5月組',          '2022年5月組',           220),
  ('2023年11月組',         '2023年11月組',          230),
  ('VΔLZ',                 'VΔLZ',                  205),
  ('今宵、××と夢を見る。', '今宵、××と夢を見る。', 500),
  ('すぷれあ',             'すぷれあ',              500)
) as v(name_ja, name_zh, sort_order)
where not exists (
  select 1 from groups g where g.name_ja = v.name_ja
);


-- =====================================================================
-- 2) 指派 talents.group_id（用 update ... from groups，子查詢安全）
-- =====================================================================

-- ★★ 確定的單位（unit）—— 優先指派，覆蓋掉之後的月組規則 ★★

-- ROF-MAO
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = 'ROF-MAO'
   and t.name_ja in ('加賀美ハヤト', '不破湊');

-- Nornis
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = 'Nornis'
   and t.name_ja in ('戌亥とこ', '町田ちま');

-- VΔLZ
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = 'VΔLZ'
   and t.name_ja in ('長尾景', '弦月藤士郎', '甲斐田晴');

-- 今宵、××と夢を見る。
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '今宵、××と夢を見る。'
   and t.name_ja = '蝸堂みかる';

-- すぷれあ
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = 'すぷれあ'
   and t.name_ja = '皇れお';


-- ★★ 月組（debut 月份分組） ★★
-- 注意：上面已指派為單位的成員，這裡的 in (...) 不會包含他們，所以不會互相覆蓋。

-- 2019年1月～3月組
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '2019年1月～3月組'
   and t.name_ja in ('夢月ロア', '語部紡', 'アンジュ・カトリーナ', 'リゼ・ヘルエスタ');

-- 2019年4月～6月組
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '2019年4月～6月組'
   and t.name_ja in ('三枝明那', '愛園愛美', '鈴原るる', '雪城眞尋',
                     'エクス・アルビオ', 'レヴィ・エリファ',
                     '葉山舞鈴', 'ニュイ・ソシエール');

-- 2019年7月～9月組（加賀美ハヤト 已在 ROF-MAO，不在這裡）
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '2019年7月～9月組'
   and t.name_ja in ('葉加瀬冬雪', '夜見れな', 'アルス・アルマル', '天宮こころ',
                     'エリー・コニファー', 'ラトナ・プティ',
                     '早瀬走', '健屋花那', 'シェリン・バーガンディ');

-- 2019年10月～12月組（不破湊 已在 ROF-MAO，不在這裡）
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '2019年10月～12月組'
   and t.name_ja in ('フミ', '星川サラ', '山神カルタ',
                     'えま★おうがすと', 'ルイス・キャミー', '魔使マオ',
                     '白雪巴', 'ましろ爻', '来栖夏芽');

-- 2020年1月組
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '2020年1月組'
   and t.name_ja in ('フレン・E・ルスタリオ', 'イブラヒム');

-- 2020年4月組（長尾/弦月/甲斐田晴）整組已在 VΔLZ，故跳過

-- 2020年6月組
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '2020年6月組'
   and t.name_ja = '空星きらめ';

-- 2022年5月組
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '2022年5月組'
   and t.name_ja = '壱百満天原サロメ';

-- 2023年11月組
update talents t
   set group_id = g.id
  from groups g
 where g.name_ja = '2023年11月組'
   and t.name_ja in ('立伝都々', '栞葉るり', 'ミラン・ケストレル');


-- =====================================================================
-- 3) 新成員自動分組函式 + trigger
-- =====================================================================
-- 沒設 group_id（或停在 default「にじさんじ」catch-all）時，
-- 依 debut_at 自動歸到「○年○月組」，找不到就自動建一個。
-- 手動指定的團體（Nornis/ROF-MAO/VΔLZ…）一律保留。
create or replace function auto_assign_talent_group()
returns trigger as $$
declare
  v_default_id  uuid;
  v_target_name text;
  v_target_id   uuid;
  v_year        int;
  v_month       int;
  v_sort        int;
begin
  select id into v_default_id from groups where name_ja = 'にじさんじ' limit 1;

  -- 已有手動分組就尊重（非 NULL 且不是 catch-all）
  if NEW.group_id is not null
     and NEW.group_id <> coalesce(v_default_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    return NEW;
  end if;

  -- 沒 debut_at 沒辦法判斷，直接放行
  if NEW.debut_at is null then
    return NEW;
  end if;

  v_year  := extract(year  from NEW.debut_at);
  v_month := extract(month from NEW.debut_at);
  v_target_name := v_year || '年' || v_month || '月組';

  select id into v_target_id from groups where name_ja = v_target_name limit 1;

  if v_target_id is null then
    v_sort := v_year * 100 + v_month;
    insert into groups (name_ja, name_zh, sort_order)
    values (v_target_name, v_target_name, v_sort)
    returning id into v_target_id;
  end if;

  NEW.group_id := v_target_id;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_auto_assign_talent_group on talents;

create trigger trg_auto_assign_talent_group
before insert or update of debut_at, group_id on talents
for each row
execute function auto_assign_talent_group();

commit;


-- =====================================================================
-- 4) 驗證（這幾段查詢可單獨跑）
-- =====================================================================

-- 4a) groups.name_ja 不應再有重複（應回 0 列）
select name_ja, count(*) as cnt
from groups
group by name_ja
having count(*) > 1;

-- 4b) 手動指定的單位有沒有被 trigger 改回月組（應顯示對應單位名）
select t.name_ja, g.name_ja as group_ja
from talents t
left join groups g on g.id = t.group_id
where t.name_ja in (
  '町田ちま','戌亥とこ',
  '加賀美ハヤト','不破湊',
  '長尾景','弦月藤士郎','甲斐田晴',
  '蝸堂みかる','皇れお'
)
order by t.name_ja;

-- 4c) 應該不再有 group = 'にじさんじ' 或 NULL 的成員
select t.name_ja, t.debut_at::date, g.name_ja as group_ja
from talents t
left join groups g on g.id = t.group_id
where g.name_ja = 'にじさんじ' or t.group_id is null
order by t.debut_at;
