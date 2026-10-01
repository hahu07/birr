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

export interface Article {
  slug: string;
  title: string;
  description: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  author: string;
  /** Who signed this off — required unless the article is still a draft. */
  reviewedBy: string | null;
  category: BlogCategory;
  /** Every article needs a picture — required, validated against ILLUSTRATION_KEYS. */
  illustration: IllustrationKey;
  draft: boolean;
  body: string;
}

export type ArticleSummary = Omit<Article, "body"> & { readMinutes: number };
