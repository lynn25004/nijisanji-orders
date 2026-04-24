import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Nijisanji Orders",
  description: "我的彩虹社周邊訂單記錄"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur sticky top-0 z-10">
          <nav className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
            <Link href="/" className="font-bold text-lg">🛍️ Niji Orders</Link>
            <div className="ml-auto flex gap-3 text-sm">
              <Link href="/" className="hover:underline">訂單列表</Link>
              <Link href="/talents" className="hover:underline">成員</Link>
              <Link href="/new" className="hover:underline">+ 新增</Link>
            </div>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
