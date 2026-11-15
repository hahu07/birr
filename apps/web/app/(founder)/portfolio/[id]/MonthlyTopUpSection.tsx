"use client";

// A founder's monthly top-up to this Waqf Fund (RecurringGift, kind
// "waqf"; owner's decision 2026-11-15): Birr charges the card saved at
// setup on the same day each month, in naira. Set up through POST
// /contributions with monthly: true; managed through
// /waqfs/:id/monthly-top-up. Only shown for an active naira fund whose
// first contribution has gone through, since a top-up adds to an
// established corpus. The backend lets only the primary contact change it.
import { useEffect, useState } from "react";
import { ApiError, apiFetchJson } from "../../../../lib/api";
import { formatMoney, humanize } from "../../../../lib/format";
import type { Waqf } from "../../../../lib/types";
import { Alert, Button, IconCheckCircle, Skeleton } from "@birr/ui";
import { MoneyInput } from "../../_components/form";

interface TopUp {
  status: "pending_setup" | "active" | "paused" | "cancelled" | "ended";
  pauseReason: "card_failed" | "card_expired" | "needs_identity" | "terms_changed" | "below_minimum" | null;
  email: string;
  amount: string;
  currency: string;
  dayOfMonth: number;
  nextChargeAt: string | null;
  card: { last4: string; brand: string | null; expMonth: number | null; expYear: number | null } | null;
  cardUpdateInProgress: boolean;
  minimumAmount: string;
  charges: { id: string; period: string | null; amount: string; status: "pending" | "confirmed" | "failed"; date: string }[];
}

interface ContributionMinimum {
  currency: string;
  minAmount: string;
}

function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

function todayInLagos(): number {
  return Math.min(Number(new Intl.DateTimeFormat("en-NG", { day: "numeric", timeZone: "Africa/Lagos" }).format(new Date())), 28);
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function MonthlyTopUpSection({ waqf }: { waqf: Waqf }) {
  const [topUp, setTopUp] = useState<TopUp | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<TopUp | null>(`/waqfs/${waqf.id}/monthly-top-up`)
      .then((data) => {
        if (!cancelled) setTopUp(data ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [waqf.id]);

  const eligible = waqf.status === "active" && waqf.corpusCurrency === "NGN" && Number(waqf.amountRaised ?? "0") > 0;
  if (!eligible && !topUp) return null;

  return (
    <div className="mt-8 border-t border-slate-100 pt-7">
      <div className="mb-3">
        <p className="mb-1 text-[15px] font-semibold text-slate-900">Monthly top-up</p>
        <p className="text-sm text-slate-500">Add to this fund automatically every month, by card.</p>
      </div>
      {loadError && (
        <Alert tone="danger" title="Couldn't load the monthly top-up">
          {loadError}
        </Alert>
      )}
      {!loadError && topUp === undefined && <Skeleton className="h-28 w-full" />}
      {!loadError && topUp === null && eligible && <SetUpTopUp waqf={waqf} />}
      {!loadError && topUp && <RunningTopUp waqfId={waqf.id} topUp={topUp} onChange={setTopUp} />}
    </div>
  );
}

function SetUpTopUp({ waqf }: { waqf: Waqf }) {
  const [minimum, setMinimum] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<ContributionMinimum[]>("/waqf-funding/contribution-minimums")
      .then((list) => setMinimum(list.find((m) => m.currency === "NGN")?.minAmount ?? null))
      .catch(() => setMinimum(null));
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { clientPayload } = await apiFetchJson<{ clientPayload: { checkoutUrl: string } }>("/contributions", {
        method: "POST",
        body: JSON.stringify({ waqfId: waqf.id, amount, currency: "NGN", provider: "paystack", monthly: true }),
      });
      window.location.href = clientPayload.checkoutUrl;
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={start} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
      {error && (
        <Alert tone="danger" title="Couldn't set up the monthly top-up" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <MoneyInput id="monthly-top-up-amount" aria-label="Monthly top-up amount" currency="NGN" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            {minimum ? `At least ${formatMoney(minimum, "NGN", { decimals: 0 })} a month. ` : ""}
            The first is charged now and saves your card; then on the <strong>{ordinal(todayInLagos())}</strong> of each month. We email you
            before each charge.
          </p>
        </div>
        <Button type="submit" disabled={busy} className="shrink-0">
          {busy ? "Opening checkout…" : "Set up monthly top-up"}
        </Button>
      </div>
    </form>
  );
}

function RunningTopUp({ waqfId, topUp, onChange }: { waqfId: string; topUp: TopUp; onChange: (t: TopUp | null) => void }) {
  const [amount, setAmount] = useState(String(Number(topUp.amount)));
  const [busy, setBusy] = useState<"amount" | "card" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  async function act<T>(kind: "amount" | "card" | "cancel", path: string, body?: unknown): Promise<T | null> {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try {
      return await apiFetchJson<T>(`/waqfs/${waqfId}/monthly-top-up/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "Only your Foundation's primary contact can change the monthly top-up." : errorText(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  const paused = topUp.status === "paused";
  const cardPaused = paused && (topUp.pauseReason === "card_failed" || topUp.pauseReason === "card_expired");
  const running = topUp.status === "active" || paused;

  return (
    <div className="rounded-xl border border-slate-200 p-4 sm:p-5">
      {error && (
        <Alert tone="danger" title="That didn't work" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-medium tabular-nums text-slate-900">
            {formatMoney(topUp.amount, topUp.currency, { decimals: 0 })}
            <span className="ml-1 text-sm font-normal text-slate-500">a month</span>
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {topUp.status === "active" && topUp.nextChargeAt
              ? `Next on ${formatDay(topUp.nextChargeAt)}`
              : topUp.status === "pending_setup"
                ? "Waiting for the first payment to go through"
                : `On the ${ordinal(topUp.dayOfMonth)} of each month`}
            {topUp.card && ` · ${topUp.card.brand ? humanize(topUp.card.brand) : "Card"} ending ${topUp.card.last4}`}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
            paused ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-primary-50 text-primary-800 ring-primary-200"
          }`}
        >
          {paused ? "Paused" : topUp.status === "pending_setup" ? "Starting" : "Active"}
        </span>
      </div>

      {cardPaused && (
        <div className="mt-4 rounded-lg bg-amber-50 p-3.5 text-sm text-amber-900">
          <p className="font-semibold">{topUp.pauseReason === "card_expired" ? "Your card has expired." : "We couldn't charge your card."}</p>
          <p className="mt-0.5">Add a card to carry on: this month&apos;s top-up is charged to it now.</p>
          <Button
            type="button"
            className="mt-3"
            disabled={busy !== null || topUp.cardUpdateInProgress}
            onClick={async () => {
              const result = await act<{ checkoutUrl: string }>("card", "card");
              if (result) window.location.href = result.checkoutUrl;
            }}
          >
            {busy === "card" ? "Opening checkout…" : topUp.cardUpdateInProgress ? "Card update in progress" : "Update card"}
          </Button>
        </div>
      )}
      {paused && topUp.pauseReason === "below_minimum" && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3.5 text-sm text-amber-900">
          The minimum has gone up to {formatMoney(topUp.minimumAmount, topUp.currency, { decimals: 0 })}. Raise the amount below to carry on.
        </p>
      )}

      {running && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-start"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await act<TopUp>("amount", "amount", { amount });
            if (result) {
              onChange(result);
              setSaved(true);
            }
          }}
        >
          <div className="flex-1">
            <MoneyInput id="monthly-top-up-new-amount" aria-label="New monthly amount" currency={topUp.currency} required value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">
              From the next charge. At least {formatMoney(topUp.minimumAmount, topUp.currency, { decimals: 0 })}.
              {saved && (
                <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-primary-700">
                  <IconCheckCircle className="h-3.5 w-3.5" /> Saved
                </span>
              )}
            </p>
          </div>
          <Button type="submit" variant="secondary" disabled={busy !== null || Number(amount) === Number(topUp.amount)} className="shrink-0">
            {busy === "amount" ? "Saving…" : "Change amount"}
          </Button>
        </form>
      )}

      {running &&
        (confirmingCancel ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50/60 p-3.5">
            <p className="text-sm text-rose-950">Stop the monthly top-up? Contributions already made stay in the fund.</p>
            <div className="mt-3 flex gap-3">
              <Button
                type="button"
                variant="danger"
                disabled={busy !== null}
                onClick={async () => {
                  if (await act<TopUp>("cancel", "cancel")) onChange(null);
                }}
              >
                {busy === "cancel" ? "Stopping…" : "Yes, stop it"}
              </Button>
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setConfirmingCancel(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingCancel(true)} className="mt-4 text-sm font-medium text-rose-700 hover:text-rose-800">
            Stop monthly top-up
          </button>
        ))}

      <p className="mt-4 text-xs text-slate-500">Reminders and receipts go to {topUp.email}.</p>
    </div>
  );
}
