import "./globals.css";
import type { ReactNode } from "react";
import NavBar from "@/components/NavBar";

export const metadata = {
  title: "我買",
  description: "我的彩虹社周邊訂單記錄",
  appleWebApp: {
    capable: true,
    title: "我買",
    statusBarStyle: "black-translucent" as const
  }
};

export const viewport = {
  themeColor: "#1f2937",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur sticky top-0 z-10">
          <NavBar />
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
