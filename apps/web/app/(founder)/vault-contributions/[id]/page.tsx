"use client";

// Where Vault's Paystack/Stripe adapters redirect a donor back to after
// checkout (see PaymentProviderAdapter.createPayment's `returnPath` and
// VaultContributionsService.initiate's own call site). A sibling of
// app/(founder)/contributions/[id]/page.tsx, deliberately not the same
// page: that one requires a Founder session (AppShell's session gate
// redirects anyone without one to /sign-in) and links to
// /portfolio/:waqfId, neither of which makes sense for a Vault donor —
// Vault is "no account of any kind involved" by design (see CLAUDE.md's
// Vault section). This page is public (see PUBLIC_ROUTE_PREFIXES in
// app-shell.tsx) and polls VaultContribution, not Contribution.
//
// 2026-09-29 codebase walkthrough finding: before this page existed,
// every real Vault Paystack donor was redirected to the Founder-only
// page above and bounced straight to /sign-in, with no confirmation of
// any kind — even though the payment itself had already succeeded.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatMoney } from "../../../../lib/format";
import type { VaultContribution } from "../../../../lib/types";
import { Alert, Button, Card, IconCheckCircle, IconClock, IconXCircle, Skeleton } from "@birr/ui";

const POLL_INTERVAL_MS = 2000;
// An abandoned or cancelled checkout never sends a webhook, so polling
// can't run forever — past this, show a "still waiting" message instead.
const POLL_GIVE_UP_AFTER_MS = 10 * 60 * 1000;
// Every Nth poll asks the provider directly (POST
// /vault-contributions/:id/verify) instead of only re-reading our own row
// — so a gift isn't stuck on a delayed or lost webhook. The backend
// rate-limits this per contribution regardless.
const VERIFY_EVERY_N_POLLS = 5;
// Past this, still polling, but say plainly that it's slower than usual.
const STALL_AFTER_MS = 120_000;

export default function VaultContributionStatusPage() {
  const params = useParams<{ id: string }>();
  const [contribution, setContribution] = useState<VaultContribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    const startedAt = Date.now();

    async function poll() {
      try {
        // A failed provider check isn't the donor's problem — fall back
        // to plain polling and keep going.
        const verified =
          polls % VERIFY_EVERY_N_POLLS === 0
            ? await apiFetchJson<VaultContribution>(`/vault-contributions/${params.id}/verify`, { method: "POST" }).catch(() => null)
            : null;
        const data = verified ?? (await apiFetchJson<VaultContribution>(`/vault-contributions/${params.id}`));
        polls += 1;
        if (cancelled) return;
        setContribution(data);
        if (data.status === "pending") {
          if (Date.now() - startedAt >= POLL_GIVE_UP_AFTER_MS) {
            setGaveUp(true);
            return;
          }
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
      setContribution(await apiFetchJson<VaultContribution>(`/vault-contributions/${params.id}/verify`, { method: "POST" }));
    } catch {
      // Nothing to show — the gift's state is unchanged either way.
    } finally {
      setChecking(false);
    }
  }

  const checkAgainButton = (
    <Button type="button" variant="secondary" className="mt-4" disabled={checking} onClick={checkAgain}>
      {checking ? "Checking…" : "Check again"}
    </Button>
  );

  return (
    <div className="mx-auto max-w-md text-center">
      {error && (
        <Alert tone="danger" title="Couldn't check your gift's status">
          {error}
        </Alert>
      )}

      {!error && !contribution && (
        <Card>
          <Skeleton className="mx-auto h-11 w-11 rounded-full" />
          <Skeleton className="mx-auto mt-4 h-4 w-48" />
        </Card>
      )}

      {!error && contribution?.status === "pending" && !gaveUp && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <IconClock className="h-5 w-5" />
          </span>
          {stalled ? (
            <>
              <p className="mt-4 text-sm font-medium text-slate-900">This is taking longer than usual</p>
              <p className="mt-1 text-sm text-slate-500">
                Your gift is safe — we&apos;re still waiting for the payment provider to confirm it. You can check again
                now; this page also keeps checking on its own.
              </p>
              {checkAgainButton}
              <ContributionReference id={contribution.id} />
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

      {!error && contribution?.status === "pending" && gaveUp && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <IconClock className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">We haven&apos;t received confirmation yet</p>
          <p className="mt-1 text-sm text-slate-500">
            If you completed payment, it may still be processing — check again, or come back to this page later.
            If you cancelled at checkout, no money was taken.
          </p>
          {checkAgainButton}
          <ContributionReference id={contribution.id} />
        </Card>
      )}

      {!error && contribution?.status === "confirmed" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconCheckCircle className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">Thank you — your gift is confirmed</p>
          <p className="mt-1 text-sm text-slate-500">
            {formatMoney(contribution.amount, contribution.currency)} to {contribution.vault.name} has
            been received.
          </p>
          <ContributionReference id={contribution.id} />
          <div className="mt-4 flex justify-center gap-4">
            <Link
              href={`/vaults/${contribution.vault.slug}`}
              className="text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              Back to {contribution.vault.name} →
            </Link>
            <Link href="/vaults" className="text-sm font-medium text-primary-700 hover:text-primary-800">
              Browse other vaults →
            </Link>
          </div>
        </Card>
      )}

      {!error && contribution?.status === "failed" && (
        <Card>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-500">
            <IconXCircle className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">Payment didn&apos;t go through</p>
          <p className="mt-1 text-sm text-slate-500">No gift was recorded — you can try again whenever you're ready.</p>
          <Link href="/vaults" className="mt-4 inline-block text-sm font-medium text-primary-700 hover:text-primary-800">
            Back to vaults →
          </Link>
        </Card>
      )}
    </div>
  );
}

// The contribution id doubles as the donor's reference — what they quote
// to Birr if they ever need to ask about this gift.
function ContributionReference({ id }: { id: string }) {
  return (
    <p className="mt-3 text-xs text-slate-500">
      Reference: <span className="break-all font-mono text-slate-700">{id}</span>
    </p>
  );
}
