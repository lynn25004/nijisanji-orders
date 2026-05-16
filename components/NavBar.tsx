"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "訂單", match: (p: string) => p === "/" || p.startsWith("/orders") },
  { href: "/wishlist", label: "想買", match: (p: string) => p.startsWith("/wishlist") },
  { href: "/discoveries", label: "雷達", match: (p: string) => p.startsWith("/discoveries") },
  { href: "/talents", label: "成員", match: (p: string) => p.startsWith("/talents") },
  { href: `/wrap/${new Date().getFullYear()}`, label: "回顧", match: (p: string) => p.startsWith("/wrap") },
  { href: "/new", label: "+ 新增", match: (p: string) => p === "/new" },
];

export default function NavBar() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
      <Link href="/" className="font-bold text-lg">🛍️ 我買</Link>
      <div className="ml-auto flex gap-1 text-sm">
        {items.map((it) => {
          const active = it.match(pathname);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={
                "px-2.5 py-1 rounded transition-colors " +
                (active
                  ? "bg-black text-white dark:bg-white dark:text-black font-semibold"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
              }
            >
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
