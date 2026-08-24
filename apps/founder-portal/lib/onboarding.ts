// Shared shape for GET /founders/me/onboarding-status, plus the route
// each step maps to. This endpoint is frontend-gate sugar only — every
// backend write path independently re-derives its own prerequisite (see
// apps/backend/src/common/auth/current-founder.ts and each service's
// own comments) — nothing here is a security boundary.
import { useEffect, useState } from "react";
import { apiFetchJson } from "./api";

export interface OnboardingStatus {
  userId: string;
  founderId: string | null;
  steps: {
    emailVerified: { complete: boolean; completedAt: string | null };
    whatsappVerified: { complete: boolean; completedAt: string | null };
    foundationEstablished: { complete: boolean; foundationId: string | null };
    firstWaqfFunded: { complete: boolean; waqfId: string | null; contributionId: string | null };
    deedSigned: { complete: boolean; waqfId: string | null; signedAt: string | null };
  };
  currentStep: 1 | 2 | 3 | 4 | "done";
  onboardingComplete: boolean;
}

export const ROUTE_FOR_STEP: Record<1 | 2 | 3 | 4, string> = {
  1: "/onboarding/verify",
  2: "/onboarding/founder-foundation",
  3: "/onboarding/waqf-fund",
  4: "/onboarding/deed",
};

/** Cookie-driven — no argument needed; call only once a session exists. */
export function useOnboardingStatus(enabled: boolean) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetchJson<OnboardingStatus>("/founders/me/onboarding-status")
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { status, loading };
}
