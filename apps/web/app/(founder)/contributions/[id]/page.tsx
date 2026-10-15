"use client";

// Where every payment provider redirects the donor back to after
// checkout (see each adapter's success_url/callback_url in
// apps/backend/src/modules/contributions/providers/*.adapter.ts).
// Never assumes the redirect alone means success: it polls
// GET /contributions/:id, and also asks the backend to check with the
// provider directly (POST /contributions/:id/verify) on arrival and every
// few seconds while pending — so a payment isn't stuck waiting on a
// webhook that was delayed, lost, or (local development) could never
// reach the backend. Past STALL_AFTER_MS it says so plainly instead of
// waiting silently forever.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import type { Contribution } from "../../../../lib/types";
import { useFounderSession } from "../../../../lib/founder-session";
import { useOnboardingStatus } from "../../../../lib/onboarding";
import { Alert, Button, Card, IconCheckCircle, IconClock, IconXCircle, Skeleton } from "@birr/ui";

const POLL_INTERVAL_MS = 2000;
// Every Nth poll asks the provider directly instead of only re-reading
// our own row (the backend rate-limits this per contribution anyway).
const VERIFY_EVERY_N_POLLS = 5;
const STALL_AFTER_MS = 120_000;

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

  const [stalled, setStalled] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    const startedAt = Date.now();

    async function poll() {
      try {
        // A failed provider check (e.g. the rail isn't configured) isn't
        // the donor's problem — fall back to plain polling and keep going.
        const verified =
          polls % VERIFY_EVERY_N_POLLS === 0
            ? await apiFetchJson<Contribution>(`/contributions/${params.id}/verify`, { method: "POST" }).catch(() => null)
            : null;
        const data = verified ?? (await apiFetchJson<Contribution>(`/contributions/${params.id}`));
        polls += 1;
        if (cancelled) return;
        setContribution(data);
        if (data.status === "pending") {
          if (Date.now() - startedAt > STALL_AFTER_MS) setStalled(true);
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

  async function checkAgain() {
    setChecking(true);
    try {
      setContribution(await apiFetchJson<Contribution>(`/contributions/${params.id}/verify`, { method: "POST" }));
    } catch {
      // Same as above — the page keeps polling regardless.
    } finally {
      setChecking(false);
    }
  }

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
          {stalled ? (
            <>
              <p className="mt-4 text-sm font-medium text-slate-900">This is taking longer than usual</p>
              <p className="mt-1 text-sm text-slate-500">
                Your payment is safe — we haven&apos;t had confirmation from the payment provider yet. You can check again
                now, or leave this page: your fund updates on its own once it&apos;s confirmed, and you&apos;ll get a
                notification.
              </p>
              <Button type="button" variant="secondary" className="mt-4" disabled={checking} onClick={checkAgain}>
                {checking ? "Checking…" : "Check again"}
              </Button>
              <p className="mt-4 text-xs text-slate-500">
                Still stuck? Contact Birr at <span className="font-medium text-slate-700">info@birrwaqf.org</span> with
                reference <span className="font-mono">{contribution.id.slice(0, 8)}</span>.
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm font-medium text-slate-900">Waiting for payment confirmation…</p>
              <p className="mt-1 text-sm text-slate-500">
                This updates automatically — no need to refresh. Bank/stablecoin confirmations can take a little
                longer than card payments.
              </p>
            </>
          )}
        </Card>
      )}

      {!error && contribution?.status === "confirmed" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
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
