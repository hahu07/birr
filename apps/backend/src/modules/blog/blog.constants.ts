// Mirrors apps/web/lib/blog-meta.ts (BLOG_CATEGORIES / ILLUSTRATION_KEYS)
// — the web app can't import from the backend and vice versa, so the two
// lists are kept in sync by hand. A value added here without its
// counterpart there would publish an article the public site can't draw.
export const BLOG_CATEGORY_KEYS = ["founder-education", "vaults", "trust", "seasonal"] as const;
export const BLOG_ILLUSTRATION_KEYS = ["endowment", "trustee", "giving-types"] as const;

export const BLOG_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** ~200 words a minute, never under one — same rule as apps/web/lib/blog.ts. */
export function readMinutes(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200));
}
