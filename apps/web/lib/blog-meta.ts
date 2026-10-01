// The fs-free half of the blog's types and constants. Split out of
// lib/blog.ts because client components (ArticleCard, via MarketingHome)
// need the category labels, and importing lib/blog.ts itself would drag
// node:fs into the browser bundle and break the build.
export const BLOG_CATEGORIES = {
  "founder-education": "For Founders",
  vaults: "Vaults & giving",
  trust: "Trust & transparency",
  seasonal: "Seasonal",
} as const;
export type BlogCategory = keyof typeof BLOG_CATEGORIES;

/** Keys of the SVGs in app/(founder)/blog/illustrations.tsx. */
export const ILLUSTRATION_KEYS = ["endowment", "trustee", "giving-types"] as const;
export type IllustrationKey = (typeof ILLUSTRATION_KEYS)[number];

/** What GET /blog-articles/public returns per article (no body). */
export interface ArticleSummary {
  slug: string;
  title: string;
  description: string;
  category: BlogCategory;
  illustration: IllustrationKey;
  authorName: string;
  /** The approving Legal/Compliance reviewer — set by the governed blog.publish action, never typed in. */
  reviewedByName: string;
  /** ISO timestamp. */
  publishedAt: string;
  readMinutes: number;
}

/** A single article, as GET /blog-articles/public/:slug returns it. */
export interface Article extends ArticleSummary {
  body: string;
}

export function formatArticleDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
