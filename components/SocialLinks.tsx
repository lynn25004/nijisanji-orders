"use client";

import { useEffect, useState } from "react";
import { getSocialBySlug, type SocialLinks } from "@/lib/social";

export default function SocialLinks({ slug }: { slug: string | null | undefined }) {
  const [s, setS] = useState<SocialLinks | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!slug) { setLoaded(true); return; }
    getSocialBySlug(slug).then((r) => { setS(r); setLoaded(true); });
  }, [slug]);

  if (!loaded || (!s?.youtube && !s?.twitter && !s?.twitch)) return null;

  const base =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium " +
    "border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 " +
    "text-neutral-700 dark:text-neutral-200 transition-all hover:-translate-y-0.5";

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {s?.youtube && (
        <a
          href={s.youtube}
          target="_blank"
          rel="noreferrer"
          className={`${base} hover:border-red-500 hover:text-red-500`}
          title="YouTube 頻道"
        >
          <span className="text-red-600">▶</span> YouTube
        </a>
      )}
      {s?.twitter && (
        <a
          href={s.twitter}
          target="_blank"
          rel="noreferrer"
          className={`${base} hover:border-sky-400 hover:text-sky-400`}
          title="X (Twitter)"
        >
          𝕏 Twitter
        </a>
      )}
      {s?.twitch && (
        <a
          href={s.twitch}
          target="_blank"
          rel="noreferrer"
          className={`${base} hover:border-purple-500 hover:text-purple-500`}
          title="Twitch 頻道"
        >
          🟣 Twitch
        </a>
      )}
    </div>
  );
}
