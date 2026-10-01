// Server-side client for the public blog endpoints (GET /blog-articles/
// public[/:slug]) — used by the Server Components under app/(founder)/
// blog, the homepage's Featured articles, the sitemap and the RSS feed.
// Articles are authored and published in the Ops Console (backend module
// blog/), not files in this repo. Fetches revalidate every few minutes
// (ISR) instead of being baked in at build time, so a newly approved
// article appears without a redeploy, and a backend that's unreachable
// at build time degrades to "no articles" rather than failing the build.
import type { Article, ArticleSummary } from "./blog-meta";

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL;
export const BLOG_REVALIDATE_SECONDS = 300;

async function getJson<T>(path: string): Promise<T | null> {
  if (!BACKEND_URL) return null;
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { next: { revalidate: BLOG_REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Newest first. Empty — never throws — if the backend can't be reached. */
export async function listPublishedArticles(limit?: number): Promise<ArticleSummary[]> {
  return (await getJson<ArticleSummary[]>(`/blog-articles/public${limit ? `?limit=${limit}` : ""}`)) ?? [];
}

export function getPublishedArticle(slug: string): Promise<Article | null> {
  return getJson<Article>(`/blog-articles/public/${encodeURIComponent(slug)}`);
}
