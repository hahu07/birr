"use client";

// Founder-facing, read-only, and deliberately an aggregate — never
// individual beneficiary rows. A beneficiary's name and eligibility
// criteria are real personal information about who receives a payout,
// and standard endowment practice keeps that confidential from the
// donor, not just from the general public. See
// BeneficiariesService.summaryForFounder's own comment.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import type { Bank, BeneficiarySummary, WaqfCause } from "../../../../lib/types";
import { Alert, Button, Combobox, Input, Skeleton, StatCard } from "@birr/ui";

export function BeneficiariesSection({ waqfId }: { waqfId: string }) {
  const [summary, setSummary] = useState<BeneficiarySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nominateState, setNominateState] = useState<"idle" | "form" | "submitted">("idle");

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<BeneficiarySummary>(`/beneficiaries/summary?waqfId=${waqfId}`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <div className="mb-1.5 flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Beneficiaries</p>
        {nominateState === "idle" && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setNominateState("form")}>
            Nominate a beneficiary
          </Button>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-500">
        Who this fund serves, in aggregate — individual identities stay confidential, same as standard endowment
        practice.
      </p>

      {nominateState === "submitted" && (
        <Alert tone="success" title="Nomination submitted" className="mb-4">
          Birr staff will review this before your fund's beneficiary count updates.
        </Alert>
      )}

      {nominateState === "form" && (
        <NominateBeneficiaryFormPanel
          waqfId={waqfId}
          onSubmitted={() => setNominateState("submitted")}
          onCancel={() => setNominateState("idle")}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load beneficiary summary">
          {error}
        </Alert>
      )}

      {!error && summary === null && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!error && summary !== null && summary.total === 0 && (
        <p className="text-sm text-slate-500">No beneficiaries registered yet.</p>
      )}

      {!error && summary !== null && summary.total > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Total beneficiaries" value={summary.total} tone="primary" />
            <StatCard label="Active" value={summary.byStatus.active} tone="success" />
            <StatCard label="Inactive" value={summary.byStatus.inactive} tone="neutral" />
          </div>
          {summary.byCause.length > 0 && (
            <div className="space-y-1.5">
              {summary.byCause.map((c) => (
                <div
                  key={c.causeId}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="text-slate-700">{c.causeName}</span>
                  <span className="font-medium text-slate-900">
                    {c.count} {c.count === 1 ? "beneficiary" : "beneficiaries"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Founder-Portal self-service — proposing someone for this waqf's
 * beneficiary list. NOT immediate registration (see
 * BeneficiaryNominationsService.propose's own comment on why beneficiary
 * identity stays independently verified by Birr, unlike Cause
 * Allocation's self-service posture) — it lands in a review queue on
 * the Ops side. Deliberately minimal, same "propose-and-confirm, no
 * status list here" convention as CausesSection.tsx's
 * SuggestCauseFormPanel: the review queue itself lives entirely on the
 * Ops side, matching CLAUDE.md's "Founder-facing surfaces stay
 * lightweight" instruction.
 */
function NominateBeneficiaryFormPanel({
  waqfId,
  onSubmitted,
  onCancel,
}: {
  waqfId: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"individual" | "organization">("individual");
  const [eligibilityCriteria, setEligibilityCriteria] = useState("");
  const [causeId, setCauseId] = useState("");
  const [causes, setCauses] = useState<WaqfCause[]>([]);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [payoutProvider, setPayoutProvider] = useState<"paystack" | "stripe" | "stablecoin">("paystack");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState(false);

  useEffect(() => {
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`)
      .then(setCauses)
      .catch(() => setCauses([]));
  }, [waqfId]);

  // Loaded on demand, once, the first time the bank picker actually
  // becomes visible — not on every mount, since most nominations never
  // touch this section at all.
  useEffect(() => {
    if (!showBankDetails || banks.length > 0 || banksLoading) return;
    setBanksLoading(true);
    apiFetchJson<Bank[]>("/banks")
      .then(setBanks)
      .catch(() => setBanksError(true))
      .finally(() => setBanksLoading(false));
  }, [showBankDetails, banks.length, banksLoading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !eligibilityCriteria.trim() || !causeId) {
      setError("Name, cause, and eligibility are all required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson("/beneficiary-nominations", {
        method: "POST",
        body: JSON.stringify({
          waqfId,
          name: name.trim(),
          kind,
          eligibilityCriteria: eligibilityCriteria.trim(),
          causeId,
          phone: phone || undefined,
          email: email || undefined,
          payoutProvider: showBankDetails ? payoutProvider : undefined,
          bankDetails:
            showBankDetails && bankName && accountNumber && accountName
              ? { bankName, accountNumber, accountName, bankCode: bankCode || undefined }
              : undefined,
        }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't submit nomination">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "individual" | "organization")}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="individual">Individual</option>
            <option value="organization">Organization (e.g. orphanage, mosque)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Cause</label>
          <select
            required
            value={causeId}
            onChange={(e) => setCauseId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">Select a cause…</option>
            {causes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[16rem] flex-[2] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Why they're eligible</label>
          <Input
            required
            placeholder='e.g. "Widowed, no income, 3 dependents"'
            value={eligibilityCriteria}
            onChange={(e) => setEligibilityCriteria(e.target.value)}
            maxLength={1000}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Phone (optional)</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="min-w-[12rem] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Email (optional)</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      {!showBankDetails ? (
        <button
          type="button"
          className="text-xs font-medium text-primary-700 hover:underline"
          onClick={() => setShowBankDetails(true)}
        >
          + Include bank details
        </button>
      ) : (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs text-slate-500">
            Shared securely with Birr for verification — you won't see this again after submitting.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Payout provider</label>
              <select
                value={payoutProvider}
                onChange={(e) => setPayoutProvider(e.target.value as "paystack" | "stripe" | "stablecoin")}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="paystack">Paystack</option>
                <option value="stripe" disabled>
                  Stripe (coming soon)
                </option>
                <option value="stablecoin" disabled>
                  Stablecoin (coming soon)
                </option>
              </select>
            </div>
            <div className="min-w-[14rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Bank</label>
              {payoutProvider === "paystack" ? (
                <>
                  <Combobox
                    options={banks.map((bank) => ({ value: bank.code, label: bank.name }))}
                    value={bankCode}
                    onChange={(code) => {
                      setBankCode(code);
                      setBankName(banks.find((bank) => bank.code === code)?.name ?? "");
                    }}
                    loading={banksLoading}
                    placeholder="Search for a bank…"
                  />
                  {banksError && <p className="mt-1 text-xs text-red-600">Couldn&apos;t load the bank list — try again shortly.</p>}
                </>
              ) : (
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
              )}
            </div>
            <div className="min-w-[10rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Account number</label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </div>
            <div className="min-w-[10rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Account name</label>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </div>
            <button
              type="button"
              className="text-xs text-slate-500 hover:underline"
              onClick={() => {
                setShowBankDetails(false);
                setBankName("");
                setAccountNumber("");
                setAccountName("");
                setBankCode("");
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
