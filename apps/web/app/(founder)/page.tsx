"use client";

// "/" is the one route that's public-or-private depending on session —
// see app-shell.tsx's HOME_ROUTE handling. Signed out: marketing page.
// Signed in: the real dashboard (DashboardOverview).
import { useFounderSession } from "../../lib/founder-session";
import MarketingHome from "./MarketingHome";
import DashboardOverview from "./DashboardOverview";

export default function HomePage() {
  const { user, loading } = useFounderSession();

  if (loading) return null;
  if (!user) return <MarketingHome />;
  return <DashboardOverview />;
}
