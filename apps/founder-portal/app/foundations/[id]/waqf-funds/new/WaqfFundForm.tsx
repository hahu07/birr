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
import { useState } from "react";
import { apiFetchJson } from "../../../../../lib/api";
import type { Waqf } from "../../../../../lib/types";
import { Alert, Button, Card } from "@birr/ui";

const WAQF_TYPES = ["investment", "asset", "project", "hybrid"] as const;

const PROVIDERS = [
  { value: "stripe", label: "Card (international)", currencies: ["USD", "EUR", "GBP"] },
  { value: "paystack", label: "Card (Nigeria)", currencies: ["NGN"] },
  { value: "stablecoin", label: "Stablecoin", currencies: ["USDC", "USDT"] },
] as const;

export function WaqfFundForm({
  foundationId,
  existingWaqf,
  cancelHref,
}: {
  foundationId: string;
  existingWaqf?: { id: string; name: string };
  cancelHref?: string;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof WAQF_TYPES)[number]>("asset");
  const [purpose, setPurpose] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");

  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["value"]>("stripe");
  const [currency, setCurrency] = useState<string>(PROVIDERS[0].currencies[0]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set once /waqfs succeeds, so a retry after a failed /contributions
  // call (e.g. below the configured minimum) reuses the same Waqf
  // instead of creating a duplicate — the same duplicate-avoidance
  // existingWaqf itself exists for, just covering the in-session case
  // rather than the reload-the-page case.
  const [createdWaqfId, setCreatedWaqfId] = useState<string | null>(null);

  function handleProviderChange(next: (typeof PROVIDERS)[number]["value"]) {
    setProvider(next);
    const match = PROVIDERS.find((p) => p.value === next)!;
    setCurrency(match.currencies[0]);
  }

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
            body: JSON.stringify({ name, type, purpose: purpose || undefined, jurisdiction, foundationId }),
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

  // Once the underlying Waqf exists (either passed in as existingWaqf,
  // or created by a previous submit in this same session), the fund-
  // detail fields are moot — a retry only needs to fix the payment side.
  const waqfAlreadyExists = Boolean(existingWaqf || createdWaqfId);
  const resolvedName = existingWaqf?.name ?? name;

  const canSubmit =
    (waqfAlreadyExists || (name.trim().length > 0 && jurisdiction.trim().length > 0)) &&
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
                Purpose <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
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
                placeholder="e.g. AE"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        </Card>
      )}

      <Card>
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">
          {waqfAlreadyExists ? `Complete payment for "${resolvedName}"` : "Declare and pay the first contribution"}
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
                onChange={(e) => setAmount(e.target.value)}
                required
                placeholder="0.00"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="currency" className="mb-1.5 block text-sm font-medium text-slate-700">
                Currency
              </label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
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
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-500">
              You&apos;ll be taken to a secure checkout to complete payment. The fund becomes active once payment
              is confirmed.
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
    </form>
  );
}
