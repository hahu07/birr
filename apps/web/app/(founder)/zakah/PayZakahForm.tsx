"use client";

// Paying zakah through Birr, as the payer's agent. Shown under the
// calculator's result. The backend refuses anything the payer didn't see:
// the agency wording's version is sent back with the payment, and the fee
// cover is recalculated server-side from the same @birr/zakah function.
import { useMemo, useState } from "react";
import { processingFeeCover } from "@birr/zakah";
import { Alert, Button, Input, Select } from "@birr/ui";
import { ApiError, apiFetchJson } from "../../../lib/api";
import { formatMoney } from "../../../lib/format";

export interface ZakahPaymentTerms {
  available: boolean;
  currency: string;
  minimumAmount: string;
  wakalah: { version: string; text: string };
}

const ID_TYPES = [
  { value: "national_id", label: "National ID (NIN)" },
  { value: "passport", label: "International passport" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "other", label: "Other" },
];

/** The day a monthly payment started today repeats on: today in Lagos, or the 28th. */
function monthlyDay(): string {
  const day = Math.min(Number(new Intl.DateTimeFormat("en-NG", { day: "numeric", timeZone: "Africa/Lagos" }).format(new Date())), 28);
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

function normaliseAmount(raw: string): string {
  return raw.replace(/[,\s₦]/g, "");
}

export function PayZakahForm({
  zakahDue,
  ruleset,
  terms,
  title = "Pay your zakah through Birr",
  fitr,
  redirectTo = (url: string) => window.location.assign(url),
}: {
  zakahDue: string;
  /** The ruleset that produced the figure, if any. */
  ruleset: { key: string; version: number } | null;
  terms: ZakahPaymentTerms;
  title?: string;
  /** Zakah al-Fitr: the amount is fixed (people × the campaign's amount) and worked out again by the server. */
  fitr?: { people: number; form: "food" | "cash" };
  /** Replaced in tests; sends the payer to Paystack's checkout. */
  redirectTo?: (url: string) => void;
}) {
  const [amount, setAmount] = useState(zakahDue);
  const [coverFee, setCoverFee] = useState(false);
  const [email, setEmail] = useState("");
  // Monthly zakah, paid in advance (owner's decision, 2026-11-15): zakah on wealth only, by card, needs an email.
  const [monthly, setMonthly] = useState(false);
  const [fullName, setFullName] = useState("");
  const [idType, setIdType] = useState("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanAmount = fitr ? zakahDue : normaliseAmount(amount);
  // Fitr's amount comes from the campaign, so the minimum doesn't apply to it.
  const validAmount = /^\d+(\.\d{1,2})?$/.test(cleanAmount) && (fitr ? Number(cleanAmount) > 0 : Number(cleanAmount) >= Number(terms.minimumAmount));
  const fee = useMemo(() => (validAmount ? processingFeeCover(cleanAmount) : null), [validAmount, cleanAmount]);
  const total = validAmount ? Number(cleanAmount) + (coverFee && fee ? Number(fee) : 0) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { clientPayload } = await apiFetchJson<{ clientPayload: { checkoutUrl: string } }>("/zakah-payments", {
        method: "POST",
        body: JSON.stringify({
          amount: cleanAmount,
          coverFee,
          wakalahConsentVersion: terms.wakalah.version,
          payerEmail: email.trim() || undefined,
          payerFullName: fullName.trim() || undefined,
          ...(needsIdentity && { idType, idNumber }),
          ...(ruleset && { rulesetKey: ruleset.key, rulesetVersion: ruleset.version }),
          ...(fitr && { kind: "fitr", fitrPeople: fitr.people, fitrForm: fitr.form }),
          ...(monthly && !fitr && { monthly: true }),
        }),
      });
      redirectTo(clientPayload.checkoutUrl);
    } catch (err) {
      if (err instanceof ApiError && ["IDENTITY_REQUIRED", "IDENTITY_CONFIRMATION_REQUIRED"].includes(err.code ?? "")) {
        setNeedsIdentity(true);
      }
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4 border-t border-slate-100 pt-5">
      <p className="text-base font-semibold text-slate-900">{title}</p>

      {!fitr && (
        <div>
          <label htmlFor="pay-amount" className="mb-1.5 block text-sm font-medium text-slate-700">
            Amount to pay
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">₦</span>
            <Input id="pay-amount" inputMode="decimal" className="pl-7 tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {!validAmount && <p className="mt-1 text-xs text-red-600">Enter at least ₦{terms.minimumAmount}, like 95000.</p>}
        </div>
      )}

      {fee && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" checked={coverFee} onChange={(e) => setCoverFee(e.target.checked)} />
          <span>
            Add {formatMoney(fee, terms.currency)} to cover the processing fee. Either way, all of your zakah reaches recipients — if you
            don&apos;t, Birr pays the fee from its own funds.
          </span>
        </label>
      )}

      {!fitr && (
        <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 has-[:checked]:border-primary-300 has-[:checked]:bg-primary-50/60">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
          <span>
            <span className="font-medium text-slate-900">Pay this every month, in advance</span>
            {monthly && (
              <span className="mt-1 block text-xs leading-relaxed text-slate-600">
                Each payment is zakah paid ahead of when it falls due (ta&apos;jil), towards your annual zakah. We charge your card the same amount on the{" "}
                <strong>{monthlyDay()}</strong> of each month, and email you before each charge with a private link to change or stop it. Some
                scholars, including the Maliki school, don&apos;t permit paying zakah early; if unsure, ask your scholar.
              </span>
            )}
          </span>
        </label>
      )}

      <div>
        <label htmlFor="pay-email" className="mb-1.5 block text-sm font-medium text-slate-700">
          {monthly && !fitr ? "Email" : "Email for your receipt"}{" "}
          {!(monthly && !fitr) && <span className="font-normal text-slate-500">(optional)</span>}
        </label>
        <Input id="pay-email" type="email" autoComplete="email" required={monthly && !fitr} value={email} onChange={(e) => setEmail(e.target.value)} />
        {monthly && !fitr ? (
          <p className="mt-1 text-xs text-slate-500">For your receipts, reminders, and the link to manage your monthly zakah.</p>
        ) : (
          !email.trim() && <p className="mt-1 text-xs text-slate-500">Without an email we can&apos;t send you a receipt.</p>
        )}
      </div>

      {needsIdentity && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-slate-700">For payments of this size we&apos;re required to confirm who you are.</p>
          <div>
            <label htmlFor="pay-name" className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
            <Input id="pay-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pay-id-type" className="mb-1.5 block text-sm font-medium text-slate-700">ID type</label>
              <Select id="pay-id-type" className="w-full" value={idType} onChange={(e) => setIdType(e.target.value)}>
                {ID_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="pay-id-number" className="mb-1.5 block text-sm font-medium text-slate-700">ID number</label>
              <Input id="pay-id-number" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
        <span>{terms.wakalah.text}</span>
      </label>

      {error && (
        <Alert tone="danger" title="That didn't work">
          {error}
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={!validAmount || !consented || submitting}>
        {submitting
          ? "Taking you to payment…"
          : total !== null
            ? `Pay ${formatMoney(String(total), terms.currency)}${monthly && !fitr ? " now, then monthly" : ""}`
            : "Pay"}
      </Button>
      <p className="text-center text-xs text-slate-500">
        {monthly && !fitr
          ? "You'll pay securely with Paystack, by card: only a card can be charged again each month."
          : "You'll pay securely with Paystack — card, bank transfer or USSD."}
      </p>
    </form>
  );
}
