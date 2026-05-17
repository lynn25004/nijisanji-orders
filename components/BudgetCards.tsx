"use client";

import { useEffect, useState } from "react";

export function BudgetCard({
  monthSpend,
  lastMonthSpend,
  jpyToTwd,
  budget,
  onSetBudget,
}: {
  monthSpend: number;
  lastMonthSpend: number;
  jpyToTwd: number;
  budget: number;
  onSetBudget: (n: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(budget || ""));
  const [animPct, setAnimPct] = useState(0);

  const pct = budget > 0 ? Math.min(100, Math.round((monthSpend / budget) * 100)) : 0;

  // mount 時從 0 動畫到目標 pct
  useEffect(() => {
    if (budget <= 0) { setAnimPct(0); return; }
    const t = setTimeout(() => setAnimPct(pct), 60);
    return () => clearTimeout(t);
  }, [pct, budget]);
  const overBudget = budget > 0 && monthSpend > budget;
  const diffPct =
    lastMonthSpend > 0
      ? Math.round(((monthSpend - lastMonthSpend) / lastMonthSpend) * 100)
      : null;

  const save = () => {
    const n = parseInt(draft.replace(/[^0-9]/g, "") || "0", 10);
    onSetBudget(n);
    setEditing(false);
  };

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 bg-white dark:bg-neutral-900 col-span-2 sm:col-span-1">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500">本月支出</div>
        {!editing && (
          <button
            onClick={() => {
              setDraft(String(budget || ""));
              setEditing(true);
            }}
            className="text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
            title="設定月預算"
          >
            {budget > 0 ? "✏️" : "＋ 預算"}
          </button>
        )}
      </div>
      <div className={`text-xl font-bold mt-0.5 ${overBudget ? "text-red-500" : ""}`}>
        ¥{monthSpend.toLocaleString()}
      </div>
      <div className="text-xs text-neutral-500 mt-0.5">
        ≈ NT${Math.round(monthSpend * jpyToTwd).toLocaleString()}
        {diffPct !== null && (
          <span
            className={`ml-2 ${
              diffPct > 0 ? "text-amber-500" : diffPct < 0 ? "text-emerald-500" : ""
            }`}
          >
            {diffPct > 0 ? "↑" : diffPct < 0 ? "↓" : ""}
            {Math.abs(diffPct)}%
            <span className="opacity-60"> vs 上月</span>
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            placeholder="JPY 月預算"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="flex-1 min-w-0 text-xs border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded px-2 py-1 outline-none focus:border-neutral-500"
            autoFocus
          />
          <button
            onClick={save}
            className="text-xs px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded"
          >
            存
          </button>
          {budget > 0 && (
            <button
              onClick={() => {
                onSetBudget(0);
                setEditing(false);
              }}
              className="text-xs px-2 py-1 text-neutral-500 hover:text-red-500"
              title="清除預算"
            >
              ✕
            </button>
          )}
        </div>
      ) : budget > 0 ? (
        <div className="mt-2">
          <div className="h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                overBudget ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${animPct}%`, transition: "width 1s cubic-bezier(.22,1,.36,1)" }}
            />
          </div>
          <div className="text-[10px] text-neutral-500 mt-1 flex justify-between">
            <span>{pct}% / ¥{budget.toLocaleString()}</span>
            <span>{overBudget ? `超 ¥${(monthSpend - budget).toLocaleString()}` : `剩 ¥${(budget - monthSpend).toLocaleString()}`}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MonthlyTrend({
  history,
  jpyToTwd,
}: {
  history: { ym: string; jpy: number }[];
  jpyToTwd: number;
}) {
  if (!history.length) return null;
  const max = Math.max(...history.map((h) => h.jpy), 1);
  const total = history.reduce((a, h) => a + h.jpy, 0);
  const avg = total / history.length;

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 bg-white dark:bg-neutral-900">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs text-neutral-500">近 6 個月</div>
        <div className="text-[11px] text-neutral-400">
          月均 ¥{Math.round(avg).toLocaleString()} (≈ NT${Math.round(avg * jpyToTwd).toLocaleString()})
        </div>
      </div>
      <div className="flex items-end gap-1.5 h-20">
        {history.map((h, i) => {
          const heightPct = max > 0 ? (h.jpy / max) * 100 : 0;
          const isCurrent = i === history.length - 1;
          const [, m] = h.ym.split("-");
          return (
            <div key={h.ym} className="flex-1 flex flex-col items-center gap-1 group">
              <div
                className="w-full text-[10px] text-center text-neutral-400 group-hover:text-neutral-700 dark:group-hover:text-neutral-200"
                title={`${h.ym}: ¥${h.jpy.toLocaleString()}`}
              >
                {h.jpy >= 10000
                  ? `${(h.jpy / 10000).toFixed(1)}萬`
                  : h.jpy >= 1000
                  ? `${(h.jpy / 1000).toFixed(0)}k`
                  : h.jpy > 0
                  ? h.jpy
                  : ""}
              </div>
              <div className="w-full flex-1 flex items-end">
                <div
                  className={`w-full rounded-t transition-all ${
                    isCurrent ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                  } group-hover:opacity-80`}
                  style={{ height: `${Math.max(heightPct, 2)}%` }}
                />
              </div>
              <div className="text-[10px] text-neutral-500">{parseInt(m, 10)}月</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
