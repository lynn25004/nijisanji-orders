# Nijisanji Orders 自動標成員系統修復紀錄

**日期**：2026-04-28（週二晚）
**目標**：讓 shop.nijisanji.jp 商品的「自動標成員」對**未來每一筆訂單**都生效，不需手動補

---

## 起始問題

訂單頁進來新商品（例如 ROF-MAO 的 On-Deck! CD），按理說 enrich-products cron 應該自動：

1. 從 `shop.nijisanji.jp/<code>.html` 抓圖、商品名、ライバー 列表
2. 把抓到的人物寫進 `product_talents` 表

但實際上：

- **ACN-10070「On-Deck!　通常盤」應該有 8 位（Oriens 4 + ROF-MAO 4），實際抓到 1 位（加賀美ハヤト）**
- 統計顯示：65 筆有圖、18 筆沒圖、13 筆完全沒成員、70 筆標籤過
- 改了商品也不會自動補上對應成員

---

## Root Cause 分析

調查後發現**多重問題疊在一起**：

### 1. Scraper（lib/scrape-shop-product.ts）抓不到完整 ライバー

**原因**：訂單裡的 shop_product_code 帶 SKU 後綴（`ACN-10070_sid020`），實際 shop 頁是 `ACN-10070.html`。

舊邏輯雖然有「最長 prefix match + allCandidates 降級」機制，但有兩個缺陷：

- **缺陷 A**：`isPageRelevant` 過嚴 — 當降級到 base code 抓到的人物名字沒出現在 `orderName` 裡，就會被判定不相關，整筆 return null。On-Deck! 訂單名是「On-Deck!　通常盤」，完全不含人名 → ACN-10053/10067/10069/10070 全部 return null。

- **缺陷 B**：原本沒有從「關連標籤（＃ROF-MAO 等）」展開成員的能力，遇到 unit 商品就漏抓。

### 2. enrich-products cron 路由的篩選條件不對

```ts
if (!force) q = q.is("image_url", null);
```

這條件只挑「沒圖」的商品。但 ACN 系列**已經有圖**（image_url 不是 null），永遠不會被選到 enrich，自然也不會補成員。

加上沒有 `ORDER BY`，每次跑都抓同一批，永遠輪不到新商品。

### 3. Vercel ↔ GitHub 自動部署斷掉

`git push` 之後 Vercel 不會自動建立新的 deployment，production 還跑著 1 天前的舊 commit。所以前面改了好幾版 scraper，**線上完全沒生效**。

### 4. CRON_SECRET 變數的 Sensitive 屬性

Vercel 環境變數設成 Sensitive 後，`vercel env pull` 拉下來是空字串、UI 也看不到完整值。導致 curl 測試一直 401。

### 5. cron-job.org 的 secret 跟 Vercel 不同步

重設 secret 之後，cron-job.org 上 7 筆排程的 URL 還是舊 secret，全部 Failed。定時任務實際上沒在跑。

---

## 修復項目（依時間順序）

### 修復 1：scraper 改進 — `lib/scrape-shop-product.ts`

**改動 1.1：用 link-list-liver 容器精準鎖定主商品 ライバー 區塊**

```ts
// 舊：直接全頁掃 ライバー 出現位置 + 後 3000 字
// 新：先找 <ul class="link-list-liver"> 容器，再抓 a 標籤
const containerMatch = segment.match(
  /<ul[^>]*link-list-liver[^>]*>([\s\S]*?)<\/ul>/
);
```

避免抓到推薦商品區塊的人物連結。

**改動 1.2：加上 unit tag 展開**

新增 `extractUnitTags` + `expandUnits`：當 ライバー 區塊是空的時候，從關連標籤（如 `<a href="/TAG_xxx">＃ROF-MAO</a>`）展開到該 group 所有成員。

```ts
const unitTags = extractUnitTags(html);
const fromUnits =
  fromLiver.length === 0 ? expandUnits(unitTags, groupMap) : [];
```

**重點**：只有 `fromLiver` 是空的才用 unit 展開，避免授權個人商品變成「整個 unit」（例如某成員的個人 voice 包但頁面有 ROF-MAO tag）。

**改動 1.3：放寬 `isPageRelevant` 條件**

舊邏輯只接受「scraped 人物名出現在 orderName」。新邏輯加一條：

```ts
// 訂單名跟 scraper title 共享 ≥4 字前綴 → 視為相關
if (co.slice(0, minLen) === ct.slice(0, minLen)) return true;
```

例如「On-Deck!　通常盤」vs ACN-10070 title「On-Deck!」前 6 字都是 `on-dec…` → 接受 fallback。

**改動 1.4（後來修正）：移除變體選單抓取**

原本加了 `extractTalentsFromVariations` 抓 `<span class="button-select-title">`，但實測發現這 class 都來自頁面右下「お客様におすすめ」推薦商品卡片，**不是主商品的**。導致 ACN-10070 多抓到一個「加賀美ハヤト」（屬於推薦商品 ROF-MAO 別張，不在 On-Deck! 名單裡）。

修正：完全移除這個函式，只用 `link-list-liver` + unit tag 兩個來源。

**改動 1.5：載入 groups + talents 對應表（30 分鐘記憶體快取）**

```ts
const _groupMembersCache: { map: Map<string, string[]>; at: number } | null = null;
```

避免每次抓商品都打 Supabase 查 groups。

---

### 修復 2：enrich-products 路由優化 — `app/api/cron/enrich-products/route.ts`

**改動 2.1：加上 created_at ASC 排序**

```ts
let q = sb.from("products")
  .select(...)
  .not("shop_product_code", "is", null)
  .order("created_at", { ascending: true })
  .limit(limit);
```

確保最舊的優先處理，不會因 PostgREST 的隨機順序卡死。

**改動 2.2：新增 `?mode=undertagged` 參數**

挑「talent count < min_talents」的商品來補（不依賴 image_url 是否為 null）。雖然這次任務沒用到，但日後遇到「商品有圖但成員不夠」的情境可以用。

**改動 2.3：response 加上 mode 欄位**

```ts
const summary = {
  ...,
  mode: mode || (force ? "force" : "missing_image"),
};
```

debug 時能立刻知道這次 cron 是用什麼條件選商品的。

---

### 修復 3：恢復 Vercel 自動部署

問題：`git push` 後 Vercel 不再自動產生新 deployment。Production 一直停在 1 天前的舊 commit。

解法：用 `npx vercel --prod` 從本地直接強制觸發部署。後續每次改完都用這個指令確保生效。

```bash
git push && npx vercel --prod
```

**注意**：之後最好查一下 Vercel ↔ GitHub 整合是不是哪個 webhook 斷了。但暫時用 CLI 解決。

---

### 修復 4：CRON_SECRET 重新產生

舊 secret 是 `sk_live_a12...` 開頭，且設為 Sensitive → 拉不出來、看不到。

解法：用 `openssl rand -hex 32` 產一個新 secret（64 字元 hex），到 Vercel UI 把 Value 換掉並**關閉 Sensitive 開關**，再 redeploy 讓新值生效。

新 secret 同時存到 `~/.nijisanji_cron_secret`，之後 export 變數從這個檔讀就好：

```bash
export CRON_SECRET=$(cat ~/.nijisanji_cron_secret)
```

---

### 修復 5：cron-job.org 7 筆 cron 同步換 secret

7 筆排程的 URL 都用 query string 帶 secret：

```
https://nijisanji-orders.vercel.app/api/cron/<endpoint>?secret=<old>
```

舊 secret 換新後，這 7 筆全部 401 Failed。

逐筆 EDIT → 改 URL → SAVE：

1. enrich-products
2. 新品（discover-shop）
3. LETAO_AUTH（sync-letao）
4. Sheet跟團（sync-sheet）
5. nijisanji-orders sync（sync-shop-nijisanji）
6. nijisanji-orders.vercel.app（sync-shop-nijisanji）
7. Gmail訂單（sync-shop-nijisanji）

⚠️ **後三筆看起來是重複的**，建議找時間整理掉冗餘的，避免每 10 分鐘同個 endpoint 被打三次。

---

## 暫時用過、後來收回的 SQL 操作

### 操作 A：把 dig 系列 image_url 設成 `__pending__`（後來改回 null）

當時 enrich-products 篩選條件還是 `image_url IS NULL`，dig 系列 13 筆 not_found 但永遠卡在第一順位，吃掉 25 秒軟死線，導致 ACN 永遠 `skipped_deadline`。

暫時把 dig 系列設成 `__pending__` 跳過 NULL 篩選，讓 ACN 能輪到處理。

ACN 處理完後改回 null：

```sql
update products set image_url = null where image_url = '__pending__';
```

### 操作 B：清掉 ACN 4 筆 product_talents 重抓

第一次抓到 9 位（含誤配的加賀美ハヤト），修掉變體掃描後重新跑一次：

```sql
delete from product_talents
where product_id in (
  select id from products where shop_product_code in (
    'ACN-10053_sid020','ACN-10067_sid020','ACN-10069_sid020','ACN-10070_sid020'
  )
);

update products set image_url = null where shop_product_code in (...);
```

第二次跑 enrich 抓到正確的 8 位 / 1 位。

---

## 最終驗證結果

### ACN-10070 訂單成員（與官網一致）

```
Oriens 4 位：佐伯イッテツ、緋八マナ、星導ショウ、叢雲カゲツ
ROF-MAO 4 位：赤城ウェン、宇佐美リト、小柳ロウ、伊波ライ
```

8 位整齊，沒有誤配。

### dig-00067_B_rou 訂單成員

```
小柳ロウ
```

商品名「小柳ロウ ほろ酔いボイス Vol.2」靠 auto-tag-products 字串比對成功補上。

### 整體統計（修復後）

| 指標 | 修復前 | 修復後 |
|---|---|---|
| 沒圖商品 | 18 | 16（ACN 4 筆補上圖了）|
| 有圖商品 | 65 | 67 |
| 沒標籤過 | 13 | **0** |
| 已標籤過 | 70 | 129（全部跑遍）|

剩下 16 筆沒圖的都是雅虎拍賣 / 美露卡里 / Amazon 等非 shop.nijisanji.jp 來源，scraper 救不了，但 auto-tag 已用商品名字串比對處理過。

---

## 之後新訂單的自動流程

每 10 分鐘 cron-job.org 觸發三個 cron：

1. **sync-shop-nijisanji**：從 Gmail 拉新訂單 → 寫入 `orders` + `products`
2. **enrich-products**：選 image_url IS NULL 的商品 → 跑 scraper → 寫圖、商品名、人物關聯
3. **auto-tag-products**：對沒標籤過的商品跑字串比對 → 補成員（針對非 shop.nijisanji.jp 的訂單）

**全自動，set-and-forget**。

---

## 修改的檔案清單

```
lib/scrape-shop-product.ts            # scraper 改進（多次迭代）
app/api/cron/enrich-products/route.ts # cron 路由優化
```

## 涉及的 commit hash

```
7966f40  feat(scrape): extract from variations + expand unit tags via groups table
f0b08b8  feat(enrich): add undertagged mode + order by created_at
b77ab05  fix(scrape): relax isPageRelevant - accept fallback when title shares prefix
3a585a1  fix(scrape): remove variation extraction (was capturing recommendations)
5ba9602  fix(scrape): remove dangling fromVariations reference
```

---

## 給未來自己的提醒

1. **Vercel 環境變數的 Sensitive 開關不要開** — 開了之後拉不出來，debug 很痛苦
2. **cron-job.org 重複的排程定期清** — 用名稱命名清楚，避免同 endpoint 被排多筆
3. **改 secret 時要同步三邊**：Vercel UI / 本地 shell / cron-job.org 上每筆 cron 的 URL
4. **修 scraper 後一定要 `npx vercel --prod`** — 不能只信 git push
5. **shop.nijisanji.jp 主商品 ライバー 區塊永遠在 `<ul class="link-list-liver">`**，其他地方的人名都是雜訊
6. **訂單品番帶 SKU 後綴** (`_sid020` 等) → 抓 shop 時要做 prefix match 降級
7. **isPageRelevant 不能太嚴**：訂單名常常只有作品名沒有人名，要靠 title 前綴比對放行
