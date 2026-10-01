"use client";

// "/" is the one route that's public-or-private depending on session —
// see app-shell.tsx's HOME_ROUTE handling. Signed out: marketing page.
// Signed in: the real dashboard (DashboardOverview). Client half of
// page.tsx, which is a Server Component so it can read blog articles
// from disk and pass the featured few down as plain props.
import { useFounderSession } from "../../lib/founder-session";
import type { ArticleSummary } from "../../lib/blog-meta";
import MarketingHome from "./MarketingHome";
import DashboardOverview from "./DashboardOverview";

export default function HomeEntry({ articles }: { articles: ArticleSummary[] }) {
  const { user, loading } = useFounderSession();

  if (loading) return null;
  if (!user) return <MarketingHome articles={articles} />;
  return <DashboardOverview />;
}
