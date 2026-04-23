# Nijisanji Orders

我的彩虹社周邊代購訂單記錄。

**技術棧**：Next.js 14 (App Router) + TypeScript + Tailwind + Supabase + Vercel。

---

## 🚀 快速上線（三步，10 分鐘）

### 1. Supabase 建專案 + 建表

1. 到 <https://app.supabase.com> → 登入 → **New project**
   - 名稱：`nijisanji-orders`
   - 密碼：自己設（記下來）
   - Region：**Tokyo**（最近）
2. 建好後左側欄 **SQL Editor** → **+ New query**
3. 把 `supabase/schema.sql` 整份貼進去 → **Run** ✅
4. 左側 **Settings → API** → 記下這兩個值待會要用：
   - `Project URL` → 當作 `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → 當作 `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. 本機跑起來

```bash
cd /mnt/d/lynn-agent/nijisanji-orders
cp .env.local.example .env.local
# 編輯 .env.local 把兩個 Supabase 值填進去
npm install
npm run dev
```

→ 開 http://localhost:3000 就能用了。

### 3. 部署到 Vercel（雲端永久版）

1. 先把 code push 到 GitHub：
   ```bash
   cd /mnt/d/lynn-agent/nijisanji-orders
   git init && git add . && git commit -m "init"
   gh repo create lynn25004/nijisanji-orders --public --source=. --push
   ```
2. 到 <https://vercel.com> → **Import Project** → 選剛剛的 repo
3. **Environment Variables** 區塊把 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 填進去
4. **Deploy** → 等 1 分鐘 → 拿到 `https://nijisanji-orders-xxx.vercel.app`

---

## 📦 現有功能（MVP / 階段 A）

- ✅ 訂單列表（手機桌面 RWD）
- ✅ 篩選：團體 / 排序（下單日、上架日）
- ✅ 新增訂單表單（代購資訊 + 商品資訊合併）
- ✅ 商品自動去重（同一個 `shop_url` 只存一筆）
- ✅ 商品 ↔ 團體綁定

## 🛠️ 下一步（未做）

- **階段 B**：Gmail IMAP 監聽代購訂單信 → Gemini 解析 → 自動填入
- **階段 C**：Firecrawl 抓 `shop.nijisanji.jp` 商品頁補封面/上架日/藝人
- 訂單詳情頁（點進去看完整 items、編輯、刪除）
- 多商品訂單（現在一筆訂單只能綁一件商品，要支援多件）
- 統計儀表板（年度花費、最常買的團體...）
- Supabase Auth 鎖住只有自己能看

---

## 📐 資料模型速查

```
groups          團體（にじさんじ / NIJISANJI EN / ROF-MAO / ...）
  ↓
talents         藝人
  ↓ (多對多 via product_talents)
products        商品（shop_url 唯一）
  ↓
order_items     訂單項目
  ↑
orders          代購訂單（Buyee 單號、手續費、運費、TWD...）
```

---

## 🐛 常見問題

**Q：部署後列表空白，console 有 RLS 錯誤？**
A：`schema.sql` 已經 `disable row level security`，若漏跑要補。

**Q：想改成多人版？**
A：先在 Supabase 開 Auth，再把所有表加 `user_id uuid references auth.users`，然後 enable RLS + 寫 policy `using (user_id = auth.uid())`。
