"use client";

// "/" is the one route that's public-or-private depending on session —
// see app-shell.tsx's HOME_ROUTE handling. Signed out: marketing page.
// Signed in: the real dashboard (DashboardOverview). Client half of
// page.tsx, which is a Server Component so it can read blog articles
// from disk and pass the featured few down as plain props.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFounderSession } from "../../lib/founder-session";
import { useOnboardingStatus } from "../../lib/onboarding";
import { takeReturnTo } from "../../lib/return-to";
import { ClinicSupport } from "./clinic-support/ClinicSupport";
import type { ArticleSummary } from "../../lib/blog-meta";
import type { FieldPhoto, ImpactSummary } from "../../lib/impact-api";
import MarketingHome from "./MarketingHome";
import DashboardOverview from "./DashboardOverview";

export default function HomeEntry({
  articles,
  impact,
  impactPhotos,
}: {
  articles: ArticleSummary[];
  impact: ImpactSummary | null;
  impactPhotos: FieldPhoto[];
}) {
  const { user, loading } = useFounderSession();
  const router = useRouter();
  const { status: onboarding } = useOnboardingStatus(!loading && Boolean(user));

  // Back to where they started, e.g. a clinic's giving page, after signing in.
  useEffect(() => {
    if (!user || !onboarding?.onboardingComplete) return;
    const returnTo = takeReturnTo();
    if (returnTo) router.replace(returnTo);
  }, [user, onboarding, router]);

  if (loading) return null;
  if (!user) return <MarketingHome articles={articles} impact={impact} impactPhotos={impactPhotos} />;
  // A Founder who joined only to support clinics has no Foundation to show (2026-11-17).
  if (onboarding?.clinicSupporterOnly) return <ClinicSupport />;
  return <DashboardOverview />;
}
