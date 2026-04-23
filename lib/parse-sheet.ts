import { createHash } from "node:crypto";

export type SheetRow = {
  dedupKey: string;
  orderedAt: string; // YYYY-MM-DD
  campaignName: string;
  items: string;
  notes: string | null;
  totalTwd: number | null;
  status: string;
  receivedAt: string | null;
};

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuote = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuote = false; i++; continue;
      }
      field += c; i++;
    } else {
      if (c === '"') { inQuote = true; i++; continue; }
      if (c === ",") { cur.push(field); field = ""; i++; continue; }
      if (c === "\n" || c === "\r") {
        cur.push(field); field = "";
        if (cur.length > 1 || cur[0] !== "") rows.push(cur);
        cur = [];
        if (c === "\r" && text[i + 1] === "\n") i += 2; else i++;
        continue;
      }
      field += c; i++;
    }
  }
  if (field !== "" || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows;
}

function parseDate(s: string): string | null {
  // "2025/12/7" → "2025-12-07"
  const m = s.trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseAmount(s: string): number | null {
  // "NT$4,512.00" → 4512
  if (!s) return null;
  const m = s.replace(/[^\d.]/g, "");
  if (!m) return null;
  const n = parseFloat(m);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

export async function fetchSheetRows(csvUrl: string): Promise<SheetRow[]> {
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iDate = col("跟團日期");
  const iName = col("跟團");
  const iItems = col("購買商品");
  const iAmount = col("金額");
  const iStatus = col("完成狀態");
  const iBonus = col("特典");

  if ([iDate, iName, iItems, iAmount, iStatus].some((i) => i < 0)) {
    throw new Error("Sheet header 缺必要欄位（跟團日期/跟團/購買商品/金額/完成狀態）");
  }

  const out: SheetRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDate(row[iDate] || "");
    const name = (row[iName] || "").trim();
    const items = (row[iItems] || "").trim();
    const status = (row[iStatus] || "").trim();
    if (!date || !name) continue;

    const total = parseAmount(row[iAmount] || "");
    const bonus = iBonus >= 0 ? (row[iBonus] || "").trim() : "";

    // notes = 購買商品 + 特典（把原始資料保留給 UI 顯示）
    const notesParts: string[] = [];
    if (items) notesParts.push(`購買商品：\n${items}`);
    if (bonus && bonus !== "無") notesParts.push(`特典：${bonus}`);
    const notes = notesParts.length ? notesParts.join("\n\n") : null;

    const receivedAt = status === "已收到" ? date : null;

    // dedupKey：date + name + items（這三者不太會變；status/total 可事後更新）
    const dedupKey = `sheet:${hash(`${date}|${name}|${items}`)}`;

    out.push({
      dedupKey,
      orderedAt: date,
      campaignName: name,
      items,
      notes,
      totalTwd: total,
      status,
      receivedAt
    });
  }
  return out;
}
