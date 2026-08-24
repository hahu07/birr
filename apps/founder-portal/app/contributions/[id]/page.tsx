"use client";

// Where every payment provider redirects the donor back to after
// checkout (see each adapter's success_url/callback_url in
// apps/backend/src/modules/contributions/providers/*.adapter.ts).
// Confirmation itself is webhook-driven and async — this page's whole
// job is to poll GET /contributions/:id until the provider's webhook
// has actually landed, not to assume the redirect alone means success.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../lib/api";
import type { Contribution } from "../../../lib/types";
import { useFounderSession } from "../../../lib/founder-session";
import { useOnboardingStatus } from "../../../lib/onboarding";
import { Alert, Card, IconCheckCircle, IconClock, IconXCircle, Skeleton } from "@birr/ui";

const POLL_INTERVAL_MS = 2000;

export default function ContributionStatusPage() {
  const params = useParams<{ id: string }>();
  const [contribution, setContribution] = useState<Contribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user } = useFounderSession();
  // Mid-onboarding, the shell already routes "/" onward to whichever
  // step is next (deed signing, at this point) — so "confirmed" links
  // to "/" rather than /portfolio/:waqfId, which isn't reachable until
  // onboarding finishes.
  const { status: onboarding } = useOnboardingStatus(Boolean(user));

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const data = await apiFetchJson<Contribution>(`/contributions/${params.id}`);
        if (cancelled) return;
        setContribution(data);
        if (data.status === "pending") {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params.id]);

  return (
    <div className="mx-auto max-w-md text-center">
      {error && (
        <Alert tone="danger" title="Couldn't check your contribution's status">
          {error}
        </Alert>
      )}

      {!error && !contribution && (
        <Card>
          <Skeleton className="mx-auto h-11 w-11 rounded-full" />
          <Skeleton className="mx-auto mt-4 h-4 w-48" />
        </Card>
      )}

      {!error && contribution?.status === "pending" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <IconClock className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">Waiting for payment confirmation…</p>
          <p className="mt-1 text-sm text-slate-500">
            This updates automatically — no need to refresh. Bank/stablecoin confirmations can take a little
            longer than card payments.
          </p>
        </Card>
      )}

      {!error && contribution?.status === "confirmed" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <IconCheckCircle className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">Contribution confirmed</p>
          <p className="mt-1 text-sm text-slate-500">Your waqf fund is now active.</p>
          <Link
            href={onboarding && !onboarding.onboardingComplete ? "/" : `/portfolio/${contribution.waqfId}`}
            className="mt-4 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            {onboarding && !onboarding.onboardingComplete ? "Continue →" : "View your waqf fund →"}
          </Link>
        </Card>
      )}

      {!error && contribution?.status === "failed" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-500">
            <IconXCircle className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">Payment didn&apos;t go through</p>
          <p className="mt-1 text-sm text-slate-500">
            Your waqf fund was created but stays in draft until a contribution is confirmed.
          </p>
          <Link
            href={onboarding && !onboarding.onboardingComplete ? "/" : "/portfolio"}
            className="mt-4 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            {onboarding && !onboarding.onboardingComplete ? "Try again →" : "Back to your portfolio →"}
          </Link>
        </Card>
      )}
    </div>
  );
}
