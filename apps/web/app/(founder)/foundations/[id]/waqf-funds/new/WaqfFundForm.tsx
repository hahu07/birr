"use client";

// Presentational form, shared by the standalone .../waqf-funds/new page
// (post-onboarding, 2nd+ Waqf Fund) and the onboarding wizard's step 3
// (app/onboarding/waqf-fund/page.tsx). Self-service (POST /waqfs), plus
// declaring and actually paying in the amount being dedicated
// (POST /contributions, real payment processing across three rails).
// The fund itself is created immediately in `draft` — it only flips to
// `active` once the contribution actually confirms.
//
// existingWaqf lets a caller skip fund creation entirely and go straight
// to payment against an already-created-but-unfunded Waqf — the retry
// path for a previous failed/abandoned payment attempt, so a second
// attempt doesn't create a duplicate Waqf.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../../../../../../lib/api";
import type { Waqf } from "../../../../../../lib/types";
import { Alert, Button, Card } from "@birr/ui";
import { WaqfTypeGuide } from "./WaqfTypeGuide";

const WAQF_TYPES = ["investment", "asset", "project"] as const;

// "stripe" (Card, international) deliberately removed — Stripe doesn't
// operate as a merchant-of-record in Nigeria at all (confirmed against
// Stripe's own documentation, 2026-09-19), so a Birr-owned Stripe
// account can never exist. The backend adapter/webhook code is real
// and untouched (apps/backend/.../providers/stripe.adapter.ts) in case
// this becomes viable later (e.g. a non-Nigerian legal entity); this is
// a product-surface decision, not evidence the code was wrong.
const PROVIDERS = [
  { value: "paystack", label: "Card (Nigeria)", currencies: ["NGN"] },
  { value: "stablecoin", label: "Stablecoin", currencies: ["USDC", "USDT"] },
] as const;

interface CorpusMinimum {
  currency: string;
  minAmount: string;
}

interface FundingSettings {
  installmentMinimumPercent: string;
}

// Only the fields this form actually reads off an already-established
// waqf — deliberately loose so both call sites can pass what they have:
// the onboarding retry path only ever has a plain list-shaped Waqf (no
// amountRaised, list() doesn't compute it), while the dedicated Top Up
// page fetches the full detail response and can pass everything.
export interface ExistingWaqfForPayment {
  id: string;
  name: string;
  corpusAmount?: string | null;
  corpusCurrency?: string | null;
  fundingPlan?: Waqf["fundingPlan"];
  amountRaised?: string;
}

export function WaqfFundForm({
  foundationId,
  existingWaqf,
  cancelHref,
}: {
  foundationId: string;
  existingWaqf?: ExistingWaqfForPayment;
  cancelHref?: string;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof WAQF_TYPES)[number]>("asset");
  const [purpose, setPurpose] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");

  const [corpusAmount, setCorpusAmount] = useState("");
  const [fundingPlan, setFundingPlan] = useState<Waqf["fundingPlan"]>("lump_sum");
  // Only ever touched directly by the founder in installment mode — lump
  // sum keeps this in sync with corpusAmount via the effect below.
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["value"]>(PROVIDERS[0].value);
  const [currency, setCurrency] = useState<string>(PROVIDERS[0].currencies[0]);

  const [corpusMinimums, setCorpusMinimums] = useState<CorpusMinimum[]>([]);
  const [contributionMinimums, setContributionMinimums] = useState<CorpusMinimum[]>([]);
  const [fundingSettings, setFundingSettings] = useState<FundingSettings | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set once /waqfs succeeds, so a retry after a failed /contributions
  // call (e.g. below the configured minimum) reuses the same Waqf
  // instead of creating a duplicate — the same duplicate-avoidance
  // existingWaqf itself exists for, just covering the in-session case
  // rather than the reload-the-page case.
  const [createdWaqfId, setCreatedWaqfId] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<CorpusMinimum[]>("/waqf-funding/corpus-minimums").then(setCorpusMinimums).catch(() => {});
    apiFetchJson<CorpusMinimum[]>("/waqf-funding/contribution-minimums").then(setContributionMinimums).catch(() => {});
    apiFetchJson<FundingSettings>("/waqf-funding/settings").then(setFundingSettings).catch(() => {});
  }, []);

  const corpusMinimumForCurrency = corpusMinimums.find((m) => m.currency === currency)?.minAmount;
  const contributionMinimumForCurrency = Number(
    contributionMinimums.find((m) => m.currency === currency)?.minAmount ?? 0,
  );
  const installmentPercent = Number(fundingSettings?.installmentMinimumPercent ?? 25);

  function handleProviderChange(next: (typeof PROVIDERS)[number]["value"]) {
    setProvider(next);
    const match = PROVIDERS.find((p) => p.value === next)!;
    setCurrency(match.currencies[0]);
  }

  // Once the underlying Waqf exists (either passed in as existingWaqf,
  // or created by a previous submit in this same session), the fund-
  // detail and corpus-declaration fields are moot — a retry/top-up only
  // needs to fix the payment side.
  const waqfAlreadyExists = Boolean(existingWaqf || createdWaqfId);

  const progress = useMemo(() => {
    if (!existingWaqf?.corpusAmount) return null;
    const raised = Number(existingWaqf.amountRaised ?? "0");
    const target = Number(existingWaqf.corpusAmount);
    if (!target) return null;
    return { raised, target, currency: existingWaqf.corpusCurrency, percent: Math.min(100, (raised / target) * 100) };
  }, [existingWaqf]);

  // The corpus/plan this payment is actually constrained by — either
  // what's being typed right now (brand-new waqf) or what an existing,
  // still-unfunded waqf already declared (a retry after leaving mid-flow,
  // or reloading before the first payment ever confirmed). Unified so
  // every rule below (lock the amount for lump sum, floor it for
  // installment) applies consistently in both cases, not just the
  // single-page creation flow.
  const effectiveCorpusAmount = waqfAlreadyExists ? (existingWaqf?.corpusAmount ?? null) : corpusAmount;
  const effectiveFundingPlan = waqfAlreadyExists ? (existingWaqf?.fundingPlan ?? "lump_sum") : fundingPlan;
  const effectiveCorpusCurrency = waqfAlreadyExists ? existingWaqf?.corpusCurrency : currency;
  // A top-up on an already-funded waqf (progress.raised > 0) has none of
  // these constraints — that's genuinely free-form additional funding,
  // per the "no cap on overfunding" decision. This is about the AMOUNT
  // only (no floor, no cap) — it says nothing about currency.
  const isFirstPayment = !waqfAlreadyExists || !progress || progress.raised === 0;
  // Both the currency and payment-method selects are locked together
  // once a corpus currency is fixed — changing payment method alone
  // (handleProviderChange) would otherwise silently overwrite currency
  // back to that provider's own default, undoing the lock below.
  //
  // Deliberately NOT gated on isFirstPayment (2026-09-29 codebase
  // walkthrough finding): a waqf's corpus currency never changes after
  // establishment, so a top-up is just as currency-constrained as the
  // first payment — only the AMOUNT is free-form for a top-up, not the
  // currency. Before this fix, a top-up on an already-funded NGN waqf
  // left both selects fully open, so picking "Stablecoin" silently
  // switched currency to USDC via handleProviderChange, and the founder
  // only found out it was wrong when POST /contributions rejected it
  // server-side ("this waqf's corpus was declared in NGN...").
  const currencyLocked = waqfAlreadyExists && Boolean(existingWaqf?.corpusCurrency);

  // The percentage-of-corpus floor for a waqf's first payment — 100%
  // for lump sum ("pay it all now"), the admin-configured percent for
  // installment. Authoritative on its own for that one payment, exactly
  // like ContributionsService.initiate()'s own logic — it does NOT also
  // have to clear the flat per-payment minimum (contributionMinimumForCurrency,
  // shown as a plain hint below instead for every OTHER payment, where
  // it's still the real floor).
  const firstPaymentFloor =
    isFirstPayment && effectiveCorpusAmount
      ? (Number(effectiveCorpusAmount) * (effectiveFundingPlan === "lump_sum" ? 100 : installmentPercent)) / 100
      : 0;

  // Lump sum: the payment is always the full corpus (or the flat
  // minimum, on the rare misconfiguration where that's somehow higher)
  // — keep it in perfect sync as the founder types the corpus amount
  // (or, for an existing unfunded waqf, as soon as its declared corpus
  // loads). Installment: default the payment to the computed floor, but
  // once the founder edits it directly, stop overwriting their choice
  // (they may want to pay more than the minimum upfront). None of this
  // applies past the first payment — a genuine top-up is free-form.
  useEffect(() => {
    if (!isFirstPayment || !effectiveCorpusAmount) return;
    if (effectiveFundingPlan === "lump_sum") {
      setAmount(firstPaymentFloor > 0 ? firstPaymentFloor.toString() : effectiveCorpusAmount);
    } else if (!amountTouched) {
      setAmount(firstPaymentFloor > 0 ? firstPaymentFloor.toString() : "");
    }
  }, [isFirstPayment, effectiveFundingPlan, effectiveCorpusAmount, firstPaymentFloor, amountTouched]);

  // Default (and lock, see the currency <select> below) the payment
  // currency to the waqf's own declared corpus currency, for every
  // payment against an existing waqf — first payment or top-up alike
  // (see currencyLocked's own comment on why this isn't isFirstPayment-
  // gated). For a first payment this also keeps the amount floor above
  // from being paired with a mismatched currency; for a top-up it's the
  // only thing preventing exactly that mismatch in the first place.
  useEffect(() => {
    if (!waqfAlreadyExists || !effectiveCorpusCurrency) return;
    setCurrency(effectiveCorpusCurrency);
    const matchingProvider = PROVIDERS.find((p) => (p.currencies as readonly string[]).includes(effectiveCorpusCurrency));
    if (matchingProvider) setProvider(matchingProvider.value);
  }, [waqfAlreadyExists, effectiveCorpusCurrency]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const waqfId =
        existingWaqf?.id ??
        createdWaqfId ??
        (
          await apiFetchJson<Waqf>("/waqfs", {
            method: "POST",
            body: JSON.stringify({
              name,
              type,
              purpose: purpose || undefined,
              jurisdiction,
              foundationId,
              corpusAmount,
              corpusCurrency: currency,
              fundingPlan,
            }),
          })
        ).id;
      if (!existingWaqf && !createdWaqfId) setCreatedWaqfId(waqfId);

      const { clientPayload } = await apiFetchJson<{ clientPayload: { checkoutUrl: string } }>("/contributions", {
        method: "POST",
        body: JSON.stringify({ waqfId, amount, currency, provider }),
      });
      window.location.href = clientPayload.checkoutUrl;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const resolvedName = existingWaqf?.name ?? name;

  const canSubmit =
    (waqfAlreadyExists ||
      (name.trim().length > 0 &&
        jurisdiction.trim().length > 0 &&
        corpusAmount.trim().length > 0 &&
        Number(corpusAmount) > 0)) &&
    amount.trim().length > 0 &&
    Number(amount) > 0 &&
    !submitting;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {submitError && (
        <Alert tone="danger" title="Couldn't establish this waqf fund">
          {submitError}
        </Alert>
      )}

      {/*
        One grid for the whole form, not two separately-widthed blocks
        stacked on top of each other — that earlier version had the
        fund-details card and the guide side by side, then a *separately
        centered*, narrower block underneath for Corpus/Payment that
        didn't line up with either column above it, with a large dead
        gap wherever the guide (four detailed entries) ran taller than
        the short form beside it. Now every card that belongs to "the
        form" — details, corpus, payment, the submit buttons — lives in
        one left-column stack of consistent width; the guide is the only
        thing in the right column, and lg:sticky keeps it in view
        alongside whichever card the founder has scrolled to, instead of
        being a fixed-height block that either runs dry or overflows.
        Only rendered as a real two-column grid when the guide is
        actually shown (!waqfAlreadyExists) — otherwise it's just a
        single centered column, same as before.
      */}
      <div className={!waqfAlreadyExists ? "grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start" : "mx-auto max-w-2xl"}>
        <div className="space-y-6">
          {!waqfAlreadyExists && (
            <Card>
              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Name
                  </label>
                  <input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder='e.g. "Northern Nigeria Orphan Education Fund"'
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor="type" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Type
                  </label>
                  <select
                    id="type"
                    value={type}
                    onChange={(e) => setType(e.target.value as (typeof WAQF_TYPES)[number])}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    {WAQF_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="purpose" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Purpose <span className="font-normal text-slate-500">(optional)</span>
                  </label>
                  <textarea
                    id="purpose"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    rows={3}
                    placeholder='e.g. "Scholarships for orphaned students at Northern Nigerian universities."'
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor="jurisdiction" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Jurisdiction
                  </label>
                  <input
                    id="jurisdiction"
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    required
                    placeholder="e.g. NG"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            </Card>
          )}

          {!waqfAlreadyExists && (
            <Card>
              <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">Waqf Corpus</p>
              <div className="space-y-4">
                <div>
                  <label htmlFor="corpusAmount" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Corpus amount — the total you're dedicating to this waqf
                  </label>
                  <input
                    id="corpusAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={corpusAmount}
                    onChange={(e) => setCorpusAmount(e.target.value)}
                    required
                    placeholder="0.00"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                  {corpusMinimumForCurrency && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Minimum for {currency}: {corpusMinimumForCurrency}
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-700">Funding plan</p>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="fundingPlan"
                        checked={fundingPlan === "lump_sum"}
                        onChange={() => {
                          setFundingPlan("lump_sum");
                          setAmountTouched(false);
                        }}
                      />
                      Lump sum — pay it all now
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="fundingPlan"
                        checked={fundingPlan === "installment"}
                        onChange={() => {
                          setFundingPlan("installment");
                          setAmountTouched(false);
                        }}
                      />
                      Installment — pay at least {installmentPercent}% now, the rest later
                    </label>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {waqfAlreadyExists && progress && (
            <Card>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Funding progress</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-primary-600" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {progress.currency} {progress.raised.toLocaleString()} of {progress.currency}{" "}
                {progress.target.toLocaleString()} raised
                {progress.raised >= progress.target && " — fully funded"}
              </p>
            </Card>
          )}

          <Card>
            <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">
              {waqfAlreadyExists ? `Add funds to "${resolvedName}"` : "Declare and pay the first contribution"}
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="amount" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Amount
                  </label>
                  <input
                    id="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAmountTouched(true);
                    }}
                    // Only lock the field once there's an actual corpus to lock
                    // it to (firstPaymentFloor > 0, same guard the helper text
                    // below already uses) — without this, a draft waqf with no
                    // corpusAmount recorded (nullable in the schema; see Waqf's
                    // own comment) left the field permanently read-only on an
                    // empty value, with no way to ever set or submit an amount.
                    readOnly={isFirstPayment && effectiveFundingPlan === "lump_sum" && firstPaymentFloor > 0}
                    required
                    placeholder="0.00"
                    className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 ${
                      isFirstPayment && effectiveFundingPlan === "lump_sum" && firstPaymentFloor > 0 ? "bg-slate-50" : "bg-white"
                    }`}
                  />
                  {isFirstPayment && effectiveFundingPlan === "lump_sum" && firstPaymentFloor > 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      A lump-sum waqf's first payment must cover the full declared corpus — at least{" "}
                      {firstPaymentFloor.toLocaleString()} {currency}.
                    </p>
                  )}
                  {isFirstPayment && effectiveFundingPlan === "installment" && firstPaymentFloor > 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      At least {installmentPercent}% of the corpus ({firstPaymentFloor.toLocaleString()} {currency}) —
                      the rest can be paid anytime as a top-up.
                    </p>
                  )}
                  {!isFirstPayment && contributionMinimumForCurrency > 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Minimum for {currency}: {contributionMinimumForCurrency.toLocaleString()}.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="currency" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Currency
                  </label>
                  <select
                    id="currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    disabled={currencyLocked}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    {PROVIDERS.find((p) => p.value === provider)!.currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="provider" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Payment method
                </label>
                <select
                  id="provider"
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as (typeof PROVIDERS)[number]["value"])}
                  disabled={currencyLocked}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">
                  {currencyLocked
                    ? `Locked to ${existingWaqf?.corpusCurrency} — this waqf's corpus was declared in that currency.`
                    : "You'll be taken to a secure checkout to complete payment. The fund becomes active once payment is confirmed."}
                </p>
              </div>
            </div>
          </Card>

          <div className="flex justify-end gap-3">
            {cancelHref && (
              <Link href={cancelHref}>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Link>
            )}
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {submitting ? "Redirecting to checkout…" : "Continue to payment"}
            </Button>
          </div>
        </div>

        {!waqfAlreadyExists && <WaqfTypeGuide selected={type} />}
      </div>
    </form>
  );
}
