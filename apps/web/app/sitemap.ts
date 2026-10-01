import type { MetadataRoute } from "next";
import { listPublishedArticles } from "../lib/blog-api";
import { SITE_URL } from "../lib/site";

// Mirrors WAQF_TYPE_SLUGS (waqf-types/content.ts), listed literally here
// because that file imports icons from "@birr/ui", whose barrel pulls
// client-only components into this server route and breaks the build.
const WAQF_TYPE_SLUGS = ["investment", "asset", "project"];

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed = ["", "/vaults", "/blog", "/sign-up", "/privacy-policy", "/terms-of-service"].map((p) => ({
    url: `${SITE_URL}${p}`,
  }));
  const types = WAQF_TYPE_SLUGS.map((s) => ({ url: `${SITE_URL}/waqf-types/${s}` }));
  const posts = (await listPublishedArticles()).map((a) => ({
    url: `${SITE_URL}/blog/${a.slug}`,
    lastModified: new Date(a.publishedAt),
  }));
  return [...fixed, ...types, ...posts];
}
