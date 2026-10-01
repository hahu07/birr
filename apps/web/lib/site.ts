// Canonical public origin, used by the sitemap, robots.txt, RSS feed and
// per-article metadata — all of which need absolute URLs. Override with
// NEXT_PUBLIC_SITE_URL per environment; falls back to Birr's production
// domain (the same one the footer's contact address uses).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://birrwaqf.org").replace(/\/+$/, "");
