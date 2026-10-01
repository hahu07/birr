import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

// /ops is Birr staff's internal console — not a security boundary (the
// backend guards are), just no reason for a crawler to index it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/ops", "/portfolio", "/contributions", "/onboarding"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
