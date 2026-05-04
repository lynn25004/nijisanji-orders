// 從 nijisanji-oshi 專案抓社群連結（YouTube/X/Twitch）
// 該檔由 build_social.py 每週自動更新（Holodex + YouTube Data API + /about scrape + manual override）
// 兩專案的 slug 一致（皆來自 nijisanji.jp 官方），可直接用 talent.slug 查詢

const SOCIAL_URL =
  "https://lynn25004.github.io/nijisanji-oshi/data/social.json";

export type SocialLinks = {
  youtube: string | null;
  twitter: string | null;
  twitch: string | null;
};

type SocialData = {
  lastUpdated: string;
  social: Record<string, SocialLinks>;
};

let _cache: Promise<SocialData | null> | null = null;

export function loadSocial(): Promise<SocialData | null> {
  if (_cache) return _cache;
  // 加 timestamp（每天換一個）規避瀏覽器舊快取，但同一天內仍能 reuse
  const t = Math.floor(Date.now() / 86400000);
  _cache = fetch(`${SOCIAL_URL}?t=${t}`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return _cache;
}

export async function getSocialBySlug(
  slug: string | null | undefined
): Promise<SocialLinks | null> {
  if (!slug) return null;
  const d = await loadSocial();
  return d?.social[slug] ?? null;
}
