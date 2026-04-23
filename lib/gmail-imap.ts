import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

export type FetchedEmail = {
  uid: number;
  messageId: string;
  date: Date;
  subject: string;
  from: string;
  text: string;
  html: string;
};

const HOST = "imap.gmail.com";
const PORT = 993;
// Gmail 各語系的 All Mail 路徑不同（英文: [Gmail]/All Mail；繁中: [Gmail]/全部郵件）
// 改用 special-use flag \All 自動找

// shop.nijisanji.jp 訂單完成信主旨（固定模板）
const SUBJECT_MATCH = "ご注文完了のお知らせ";
const FROM_MATCH = "shop.nijisanji.jp";

export async function fetchShopNijisanjiOrderEmails(opts?: {
  sinceDays?: number;
}): Promise<FetchedEmail[]> {
  const email = process.env.GMAIL_EMAIL;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!email || !pass) throw new Error("Missing GMAIL_EMAIL / GMAIL_APP_PASSWORD");

  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user: email, pass },
    logger: false
  });

  const out: FetchedEmail[] = [];
  await client.connect();
  try {
    // 用 All Mail 才能抓到已歸檔的；\All special-use flag 跨語系都能找
    const boxes = await client.list();
    const allMailbox =
      boxes.find((b) => b.specialUse === "\\All")?.path || "INBOX";
    const lock = await client.getMailboxLock(allMailbox);
    try {
      const since = new Date();
      since.setDate(since.getDate() - (opts?.sinceDays ?? 180));

      // X-GM-RAW 讓我們用 Gmail 原生搜尋語法
      const query = `from:${FROM_MATCH} subject:"${SUBJECT_MATCH}"`;
      const uids = await client.search(
        { gmailraw: query, since },
        { uid: true }
      );

      if (!uids || uids.length === 0) return out;

      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, source: true },
        { uid: true }
      )) {
        if (!msg.source) continue;
        const parsed: ParsedMail = await simpleParser(msg.source);
        out.push({
          uid: msg.uid,
          messageId: parsed.messageId || `uid:${msg.uid}`,
          date: parsed.date || new Date(),
          subject: parsed.subject || "",
          from: parsed.from?.text || "",
          text: parsed.text || "",
          html: typeof parsed.html === "string" ? parsed.html : ""
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}
