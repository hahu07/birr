"use client";

// One counterparty's full vetting/exposure picture. Two independent
// gates must both clear before `status` can become `active` (see
// Counterparty's own schema comment): (1) a shariah_board_member's own
// sign-off, recorded directly here; (2) a counterparty.onboard
// governed_action (investment_committee proposes, several roles can
// check) — its approval is refused server-side unless gate (1) already
// happened. Suspend/blacklist are immediate, unilateral compliance_officer
// actions — no maker-checker, since stopping a bad actor needs speed.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { Counterparty, CounterpartyExposure, GovernedAction, InvestmentPlacementSummary } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, DetailGrid, EmptyState, Input, Skeleton } from "@birr/ui";

const STATUS_TONE: Record<Counterparty["status"], "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  pending_review: "neutral",
  under_review: "warning",
  suspended: "warning",
  blacklisted: "danger",
};

export default function CounterpartyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { staff } = useStaffSession();
  const [counterparty, setCounterparty] = useState<Counterparty | null>(null);
  const [exposure, setExposure] = useState<CounterpartyExposure | null>(null);
  const [placements, setPlacements] = useState<InvestmentPlacementSummary[] | null>(null);
  // Undefined = not checked yet; null = checked, none pending. Fetched
  // from the same general Approval Queue endpoint, filtered client-side —
  // there's no dedicated "pending proposal for this counterparty" route.
  // This is what stops the "Propose onboarding" button from just sitting
  // there with no feedback after a successful proposal, inviting repeat
  // clicks that pile up duplicate proposals (the real bug this fixes).
  const [pendingProposal, setPendingProposal] = useState<GovernedAction | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<Counterparty>(`/counterparties/${id}`),
      apiFetchJson<CounterpartyExposure>(`/counterparties/${id}/exposure`),
      apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed"),
      apiFetchJson<InvestmentPlacementSummary[]>(`/investment-placements?counterpartyId=${id}`),
    ])
      .then(([c, e, actions, p]) => {
        setCounterparty(c);
        setExposure(e);
        setPendingProposal(
          actions.find(
            (a) => a.permission.key === "counterparty.onboard" && (a.payload as { counterpartyId?: string })?.counterpartyId === id,
          ) ?? null,
        );
        setPlacements(p);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(fn: () => Promise<unknown>) {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this counterparty">
        {error}
      </Alert>
    );
  }

  if (!counterparty) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
    );
  }

  if (counterparty.deletedAt) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link href="/ops/counterparties" className="text-sm font-medium text-primary-700 hover:text-primary-800">
          ← Counterparties
        </Link>
        <header className="mb-6 mt-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{counterparty.name}</h1>
          <Badge tone="neutral">Deregistered</Badge>
        </header>
        <Alert tone="neutral" title="This counterparty has been deregistered">
          Deregistered {formatDate(counterparty.deletedAt)}. It's kept for audit history but no longer appears in
          the active registry, and no further action can be taken on it here.
        </Alert>
      </div>
    );
  }

  const isShariahBoard = staff?.staffRole === "shariah_board_member";
  const isComplianceOfficer = staff?.staffRole === "compliance_officer";
  const isInvestmentCommittee = staff?.staffRole === "investment_committee";
  // Includes "suspended"/"blacklisted" — reactivating either goes back
  // through this same onboarding gate (see CounterpartiesService.onboard's
  // own comment). A blacklisted one won't actually have shariahApprovedAt
  // set (blacklist() clears it), so the "propose onboarding" button below
  // still correctly waits on a fresh Shariah approval first for that case.
  const canOnboard =
    counterparty.status === "pending_review" ||
    counterparty.status === "under_review" ||
    counterparty.status === "suspended" ||
    counterparty.status === "blacklisted";

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/ops/counterparties" className="text-sm font-medium text-primary-700 hover:text-primary-800">
        ← Counterparties
      </Link>

      <header className="mb-6 mt-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{counterparty.name}</h1>
        <Badge tone={STATUS_TONE[counterparty.status]}>{humanize(counterparty.status)}</Badge>
      </header>

      {actionError && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-4">
          {actionError}
        </Alert>
      )}

      <Card>
        <div className="flex items-start justify-between gap-3">
          <DetailGrid
            columns={2}
            items={[
              { label: "Type", value: humanize(counterparty.institutionType) },
              { label: "Jurisdiction", value: counterparty.jurisdiction },
              { label: "Registration number", value: counterparty.registrationNumber ?? "—" },
              { label: "Address", value: counterparty.address ?? "—" },
              { label: "Website", value: counterparty.website ?? "—" },
              {
                label: "Contact",
                value:
                  counterparty.contactName || counterparty.contactEmail || counterparty.contactPhone
                    ? [counterparty.contactName, counterparty.contactEmail, counterparty.contactPhone].filter(Boolean).join(" · ")
                    : "—",
              },
              { label: "Regulating authority", value: counterparty.regulatingAuthority ?? "—" },
              { label: "License number", value: counterparty.regulatoryLicenseNumber ?? "—" },
              {
                label: "Shariah approval",
                value: counterparty.shariahApprovedAt ? `Signed off ${formatDate(counterparty.shariahApprovedAt)}` : "Not yet recorded",
              },
              { label: "Registered", value: formatDate(counterparty.createdAt) },
            ]}
          />
          {isInvestmentCommittee && (
            <Button
              variant="secondary"
              className="shrink-0 px-3 py-1.5 text-xs"
              onClick={() => setShowEditForm((v) => !v)}
            >
              {showEditForm ? "Cancel" : "Edit details"}
            </Button>
          )}
        </div>

        {showEditForm && isInvestmentCommittee && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <EditProfileForm
              counterparty={counterparty}
              disabled={busy}
              onSave={(input) =>
                runAction(() =>
                  apiFetchJson(`/counterparties/${counterparty.id}`, { method: "PUT", body: JSON.stringify(input) }),
                ).then(() => setShowEditForm(false))
              }
              onCancel={() => setShowEditForm(false)}
            />
          </div>
        )}

        {counterparty.businessActivities && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Business activities</p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{counterparty.businessActivities}</p>
          </div>
        )}

        {counterparty.existingShariahCertification && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Existing Shariah certification</p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{counterparty.existingShariahCertification}</p>
          </div>
        )}

        {counterparty.notes && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Notes</p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{counterparty.notes}</p>
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-5">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Exposure</p>
          {exposure && (
            <p className="text-sm text-slate-700">
              {formatAmount(exposure.totalInvested)} invested across every waqf combined
              {exposure.concentrationLimit ? (
                <>
                  {" "}
                  — {formatAmount(exposure.remaining ?? "0")} of a {formatAmount(exposure.concentrationLimit)}{" "}
                  {exposure.concentrationLimitCurrency} concentration limit remains
                </>
              ) : (
                " — no concentration limit set yet"
              )}
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
          {!counterparty.shariahApprovedAt && isShariahBoard && (
            <Button disabled={busy} onClick={() => runAction(() => apiFetchJson(`/counterparties/${counterparty.id}/shariah-approval`, { method: "POST" }))}>
              Record Shariah approval
            </Button>
          )}
          {canOnboard && counterparty.shariahApprovedAt && pendingProposal === null && isInvestmentCommittee && (
            <Button
              disabled={busy}
              onClick={() =>
                runAction(() =>
                  apiFetchJson("/governed-actions", {
                    method: "POST",
                    body: JSON.stringify({
                      permissionKey: "counterparty.onboard",
                      payload: { counterpartyId: counterparty.id },
                    }),
                  }),
                )
              }
            >
              Propose onboarding
            </Button>
          )}
          {canOnboard && counterparty.shariahApprovedAt && pendingProposal && (
            <p className="self-center text-xs text-slate-500">
              Onboarding already proposed{pendingProposal.makerUser ? ` by ${pendingProposal.makerUser.fullName}` : ""} on{" "}
              {formatDate(pendingProposal.createdAt)} — awaiting a checker's decision in the{" "}
              <Link href="/ops/governed-actions" className="font-medium text-primary-700 hover:text-primary-800">
                Approvals queue
              </Link>
              .
            </p>
          )}
          {canOnboard && counterparty.shariahApprovedAt && pendingProposal === null && !isInvestmentCommittee && (
            <p className="self-center text-xs text-slate-500">
              Shariah approval is recorded — an investment_committee member still needs to propose onboarding
              (Approvals queue) before this counterparty can go active.
            </p>
          )}
          {counterparty.status !== "blacklisted" && isComplianceOfficer && (
            <StatusActionButton
              label="Suspend"
              variant="secondary"
              disabled={busy}
              onSubmit={(reason) => runAction(() => apiFetchJson(`/counterparties/${counterparty.id}/suspend`, { method: "POST", body: JSON.stringify({ reason }) }))}
            />
          )}
          {counterparty.status !== "blacklisted" && isComplianceOfficer && (
            <StatusActionButton
              label="Blacklist"
              variant="danger"
              disabled={busy}
              onSubmit={(reason) => runAction(() => apiFetchJson(`/counterparties/${counterparty.id}/blacklist`, { method: "POST", body: JSON.stringify({ reason }) }))}
            />
          )}
          {isInvestmentCommittee && (
            <ConfirmButton
              label="Delete"
              confirmLabel="Confirm delete?"
              variant="danger"
              disabled={busy}
              onConfirm={() => runAction(() => apiFetchJson(`/counterparties/${counterparty.id}/deregister`, { method: "POST" }))}
            />
          )}
        </div>

        {isComplianceOfficer && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <ConcentrationLimitForm
              counterparty={counterparty}
              disabled={busy}
              onSet={(amount, currency) =>
                runAction(() =>
                  apiFetchJson(`/counterparties/${counterparty.id}/concentration-limit`, {
                    method: "PUT",
                    body: JSON.stringify({ amount, currency }),
                  }),
                )
              }
            />
          </div>
        )}
      </Card>

      {counterparty.status === "active" && (
        <Card className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Placements</p>
              <p className="text-xs text-slate-500">Every bulk investment tranche placed with this counterparty.</p>
            </div>
            {isInvestmentCommittee && (
              <Link href={`/ops/counterparties/${counterparty.id}/place`}>
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Place investment across funds
                </Button>
              </Link>
            )}
          </div>

          {placements === null && <p className="text-sm text-slate-500">Loading…</p>}

          {placements && placements.length === 0 && (
            <EmptyState
              title="No placements yet"
              description="Bulk-place across multiple Waqf Funds instead of one investment form per fund."
            />
          )}

          {placements && placements.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {placements.map((p) => {
                const total = p.investments
                  .filter((i) => i.status === "active")
                  .reduce((sum, i) => sum + Number(i.allocatedAmount), 0);
                return (
                  <li key={p.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <Link
                        href={`/ops/investment-placements/${p.id}`}
                        className="text-sm font-medium text-primary-700 hover:text-primary-800"
                      >
                        {p.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {humanize(p.instrumentType)} · {p.investments.length} fund
                        {p.investments.length === 1 ? "" : "s"} · {formatDate(p.createdAt)}
                      </p>
                    </div>
                    <p className="text-sm text-slate-600">{formatAmount(total)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

// Two-click confirm, no reason field needed (unlike suspend/blacklist) —
// deregistering is for cleaning up a registration mistake, and the audit
// log's before/after snapshot plus actor/timestamp already say enough.
function ConfirmButton({
  label,
  confirmLabel,
  variant,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  variant: "secondary" | "danger";
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <Button
      variant={variant}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

function StatusActionButton({
  label,
  variant,
  disabled,
  onSubmit,
}: {
  label: string;
  variant: "secondary" | "danger";
  disabled: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");

  if (!showForm) {
    return (
      <Button variant={variant} disabled={disabled} onClick={() => setShowForm(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div className="flex items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="min-w-[14rem] space-y-1">
        <label className="text-xs font-medium text-slate-700">Reason</label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button
        variant={variant}
        className="px-3 py-1.5 text-xs"
        disabled={disabled || !reason.trim()}
        onClick={() => {
          onSubmit(reason.trim());
          setShowForm(false);
          setReason("");
        }}
      >
        Confirm {label.toLowerCase()}
      </Button>
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setShowForm(false)}>
        Cancel
      </Button>
    </div>
  );
}

interface CounterpartyProfileInput {
  jurisdiction: string;
  registrationNumber?: string;
  address?: string;
  businessActivities?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  regulatoryLicenseNumber?: string;
  regulatingAuthority?: string;
  existingShariahCertification?: string;
}

function EditProfileForm({
  counterparty,
  disabled,
  onSave,
  onCancel,
}: {
  counterparty: Counterparty;
  disabled: boolean;
  onSave: (input: CounterpartyProfileInput) => void;
  onCancel: () => void;
}) {
  const [jurisdiction, setJurisdiction] = useState(counterparty.jurisdiction);
  const [registrationNumber, setRegistrationNumber] = useState(counterparty.registrationNumber ?? "");
  const [address, setAddress] = useState(counterparty.address ?? "");
  const [businessActivities, setBusinessActivities] = useState(counterparty.businessActivities ?? "");
  const [website, setWebsite] = useState(counterparty.website ?? "");
  const [contactName, setContactName] = useState(counterparty.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(counterparty.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(counterparty.contactPhone ?? "");
  const [regulatoryLicenseNumber, setRegulatoryLicenseNumber] = useState(counterparty.regulatoryLicenseNumber ?? "");
  const [regulatingAuthority, setRegulatingAuthority] = useState(counterparty.regulatingAuthority ?? "");
  const [existingShariahCertification, setExistingShariahCertification] = useState(counterparty.existingShariahCertification ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      jurisdiction,
      registrationNumber: registrationNumber || undefined,
      address: address || undefined,
      businessActivities: businessActivities || undefined,
      website: website || undefined,
      contactName: contactName || undefined,
      contactEmail: contactEmail || undefined,
      contactPhone: contactPhone || undefined,
      regulatoryLicenseNumber: regulatoryLicenseNumber || undefined,
      regulatingAuthority: regulatingAuthority || undefined,
      existingShariahCertification: existingShariahCertification || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Jurisdiction</label>
          <Input required value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Registration number</label>
          <Input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Website</label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Address</label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Business activities</label>
        <textarea
          rows={3}
          value={businessActivities}
          onChange={(e) => setBusinessActivities(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Existing Shariah certification</label>
        <Input
          value={existingShariahCertification}
          onChange={(e) => setExistingShariahCertification(e.target.value)}
          placeholder="Name/reference of any Shariah board or certification this counterparty already holds, if any"
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Contact name</label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Contact email</label>
          <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Contact phone</label>
          <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Regulatory license number</label>
          <Input value={regulatoryLicenseNumber} onChange={(e) => setRegulatoryLicenseNumber(e.target.value)} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Regulating authority</label>
          <Input value={regulatingAuthority} onChange={(e) => setRegulatingAuthority(e.target.value)} />
        </div>
        <Button type="submit" disabled={disabled}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ConcentrationLimitForm({
  counterparty,
  disabled,
  onSet,
}: {
  counterparty: Counterparty;
  disabled: boolean;
  onSet: (amount: string, currency: string) => void;
}) {
  const [amount, setAmount] = useState(counterparty.concentrationLimit ?? "");
  const [currency, setCurrency] = useState(counterparty.concentrationLimitCurrency ?? "USD");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-40 space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Concentration limit</label>
        <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="w-28 space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Currency</label>
        <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
      </div>
      <Button disabled={disabled || !amount.trim()} onClick={() => onSet(amount.trim(), currency.trim())}>
        Set limit
      </Button>
    </div>
  );
}
