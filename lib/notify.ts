// Telegram 推播：沒設 env 就靜默 no-op，不讓通知錯誤拖垮主流程
export async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
  } catch {
    /* ignore */
  }
}

/** 動態內容進 HTML 訊息前要跳脫，否則含 & < > 的商品名會讓 Telegram 回 400 而整則靜靜消失 */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 這則通知是哪一版程式發的（Vercel 會自動帶 commit sha）＋ 台北時間 */
export function buildTag(): string {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7);
  const t = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(5, 16);
  return `build ${sha} ・ ${t}`;
}
