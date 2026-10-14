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
import { formatMoney } from "../../../../../../lib/format";
import type { Waqf } from "../../../../../../lib/types";
import { Alert, Button, IconShieldCheck, Select } from "@birr/ui";
import { TYPE_GUIDE, WaqfTypeGuide } from "./WaqfTypeGuide";
import { ChoiceCard, Field, FormSection, inputClass, MoneyInput } from "../../../../_components/form";

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

  const amountLocked = isFirstPayment && effectiveFundingPlan === "lump_sum" && firstPaymentFloor > 0;
  const providerLabel = PROVIDERS.find((p) => p.value === provider)!.label;
  // Numbered only when there's more than one step on screen (a brand-new
  // fund); a top-up/retry is the payment step alone.
  const paymentStep = waqfAlreadyExists ? undefined : 3;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {submitError && (
        <Alert tone="danger" title="Couldn't establish this waqf fund">
          {submitError}
        </Alert>
      )}

      {/*
        One grid for the whole form: every card that belongs to "the
        form" — details, corpus, payment, the submit bar — lives in one
        left-column stack of consistent width; the selected type's guide
        is the only thing in the right column, sticky so it stays in view
        alongside whichever card the founder has scrolled to. Only a real
        two-column grid when the guide is shown (!waqfAlreadyExists) —
        otherwise a single centered column.
      */}
      <div className={!waqfAlreadyExists ? "grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start" : "mx-auto max-w-2xl"}>
        <div className="space-y-6">
          {!waqfAlreadyExists && (
            <FormSection step={1} title="Fund details" description="What this Waqf Fund is, and the jurisdiction it's governed under.">
              <div className="space-y-5">
                <Field label="Name" htmlFor="name">
                  <input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder='e.g. "Northern Nigeria Orphan Education Fund"'
                    className={inputClass}
                  />
                </Field>
                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-slate-800">Type</legend>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {WAQF_TYPES.map((t) => (
                      <ChoiceCard
                        key={t}
                        name="type"
                        checked={type === t}
                        onChange={() => setType(t)}
                        title={TYPE_GUIDE[t].label}
                        body={TYPE_GUIDE[t].summary}
                      />
                    ))}
                  </div>
                  {/* Phones: the full explanation sits right here; on
                      desktop it's the sticky WaqfTypeGuide beside the form. */}
                  <p className="mt-2.5 rounded-xl bg-primary-50/70 p-3 text-xs leading-relaxed text-slate-600 lg:hidden">
                    {TYPE_GUIDE[type].description}
                  </p>
                </fieldset>
                <Field label="Purpose" optional htmlFor="purpose">
                  <textarea
                    id="purpose"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    rows={3}
                    placeholder='e.g. "Scholarships for orphaned students at Northern Nigerian universities."'
                    className={inputClass}
                  />
                </Field>
                <Field label="Jurisdiction" htmlFor="jurisdiction" hint="The country whose rules govern this fund, as a 2-letter code — e.g. NG for Nigeria.">
                  <input
                    id="jurisdiction"
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    required
                    placeholder="e.g. NG"
                    className={`${inputClass} sm:max-w-[10rem]`}
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {!waqfAlreadyExists && (
            <FormSection step={2} title="Waqf corpus" description="The total you're dedicating to this waqf, and how you'll pay it in.">
              <div className="space-y-5">
                <Field
                  label="Corpus amount"
                  htmlFor="corpusAmount"
                  hint={corpusMinimumForCurrency ? `Minimum ${formatMoney(corpusMinimumForCurrency, currency, { decimals: 0 })}` : undefined}
                >
                  <MoneyInput
                    id="corpusAmount"
                    currency={currency}
                    value={corpusAmount}
                    onChange={(e) => setCorpusAmount(e.target.value)}
                    required
                  />
                </Field>
                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-slate-800">Funding plan</legend>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <ChoiceCard
                      name="fundingPlan"
                      checked={fundingPlan === "lump_sum"}
                      onChange={() => {
                        setFundingPlan("lump_sum");
                        setAmountTouched(false);
                      }}
                      title="Lump sum"
                      body="Pay the full corpus now."
                    />
                    <ChoiceCard
                      name="fundingPlan"
                      checked={fundingPlan === "installment"}
                      onChange={() => {
                        setFundingPlan("installment");
                        setAmountTouched(false);
                      }}
                      title="Installments"
                      body={`Pay at least ${installmentPercent}% now, top up the rest anytime.`}
                    />
                  </div>
                </fieldset>
              </div>
            </FormSection>
          )}

          {waqfAlreadyExists && progress && (
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Funding progress</p>
                <p className="text-xs font-medium tabular-nums text-slate-500">{Math.floor(progress.percent)}%</p>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-primary-600" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="mt-2.5 text-sm text-slate-600">
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatMoney(progress.raised, progress.currency ?? "", { decimals: 0 })}
                </span>{" "}
                of {formatMoney(progress.target, progress.currency ?? "", { decimals: 0 })} raised
                {progress.raised >= progress.target && " — fully funded"}
              </p>
            </div>
          )}

          <FormSection
            step={paymentStep}
            title={waqfAlreadyExists ? `Add funds to "${resolvedName}"` : "First contribution"}
            description={waqfAlreadyExists ? "Paid through a secure checkout; it's added to this fund once confirmed." : "The fund becomes active once this payment is confirmed."}
          >
            <div className="space-y-5">
              <fieldset disabled={currencyLocked}>
                <legend className="mb-2 block text-sm font-medium text-slate-800">Payment method</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {PROVIDERS.map((p) => (
                    <ChoiceCard
                      key={p.value}
                      name="provider"
                      checked={provider === p.value}
                      onChange={() => handleProviderChange(p.value)}
                      title={p.value === "paystack" ? "Card or bank (Nigeria)" : "Stablecoin"}
                      body={p.value === "paystack" ? "Naira, via Paystack" : "USDC or USDT"}
                      disabled={currencyLocked && provider !== p.value}
                    />
                  ))}
                </div>
                {currencyLocked && (
                  <p className="mt-2 text-xs text-slate-500">
                    Locked to {existingWaqf?.corpusCurrency} — this waqf's corpus was declared in that currency.
                  </p>
                )}
              </fieldset>

              {/* Only the stablecoin rail has more than one currency to pick. */}
              {PROVIDERS.find((p) => p.value === provider)!.currencies.length > 1 && (
                <Field label="Currency" htmlFor="currency">
                  <Select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={currencyLocked} className="sm:max-w-[12rem]">
                    {PROVIDERS.find((p) => p.value === provider)!.currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field
                label="Amount"
                htmlFor="amount"
                hint={
                  isFirstPayment && effectiveFundingPlan === "lump_sum" && firstPaymentFloor > 0
                    ? `A lump-sum fund's first payment covers the full declared corpus — ${formatMoney(firstPaymentFloor, currency, { decimals: 0 })}.`
                    : isFirstPayment && effectiveFundingPlan === "installment" && firstPaymentFloor > 0
                      ? `At least ${installmentPercent}% of the corpus (${formatMoney(firstPaymentFloor, currency, { decimals: 0 })}) — the rest can be paid anytime as a top-up.`
                      : !isFirstPayment && contributionMinimumForCurrency > 0
                        ? `Minimum ${formatMoney(contributionMinimumForCurrency, currency, { decimals: 0 })}.`
                        : undefined
                }
              >
                <MoneyInput
                  id="amount"
                  currency={currency}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setAmountTouched(true);
                  }}
                  // Only lock the field once there's an actual corpus to lock
                  // it to (firstPaymentFloor > 0, same guard the hint above
                  // uses) — without this, a draft waqf with no corpusAmount
                  // recorded (nullable in the schema; see Waqf's own
                  // comment) left the field permanently read-only on an
                  // empty value, with no way to ever set or submit an amount.
                  readOnly={amountLocked}
                  required
                />
              </Field>
            </div>
          </FormSection>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                  <IconShieldCheck className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <p className="text-sm text-slate-600">
                    {Number(amount) > 0 ? (
                      <>
                        You'll pay{" "}
                        <span className="font-semibold tabular-nums text-slate-900">{formatMoney(amount, currency)}</span> via{" "}
                        {providerLabel === "Card (Nigeria)" ? "Paystack" : "stablecoin checkout"}.
                      </>
                    ) : (
                      "Enter an amount to continue."
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">You'll be taken to a secure checkout, then brought back here.</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2.5">
                {cancelHref && (
                  <Link href={cancelHref} className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Cancel
                  </Link>
                )}
                <Button type="submit" variant="primary" disabled={!canSubmit} className="rounded-lg px-5 py-2.5 font-semibold">
                  {submitting ? "Redirecting to checkout…" : "Continue to payment"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {!waqfAlreadyExists && <WaqfTypeGuide selected={type} />}
      </div>
    </form>
  );
}
