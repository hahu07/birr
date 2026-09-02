"use client";

// Beneficiary registration is plain CRUD — eligibility-criteria changes
// and enable/disable are both governed_actions (beneficiary
// .criteria_update, beneficiary.status_change), decided on the Approval
// Queue page (never here) — propose controls for both live in this
// file's own table (CriteriaUpdateAction / StatusChangeAction below).
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, humanize } from "../../../../lib/format";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";
import { markNotificationsReadForEntity } from "../../../../lib/notifications";
import type { Beneficiary, BeneficiaryNomination, WaqfCause } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../../_components/SectionChrome";

export function BeneficiariesSection({
  waqfId,
  causesVersion,
  onChanged,
}: {
  waqfId: string;
  causesVersion: number;
  onChanged: () => void;
}) {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[] | null>(null);
  const [causes, setCauses] = useState<WaqfCause[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<Beneficiary[]>(`/beneficiaries?waqfId=${waqfId}`)
      .then(setBeneficiaries)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // includeInactive=true — an existing beneficiary can already be pinned
    // to a cause the founder has since unselected; causeName() below still
    // needs to resolve it. activeCauses (derived below) is what the "add
    // beneficiary" form actually offers.
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}&includeInactive=true`)
      .then(setCauses)
      .catch(() => setCauses([]));
  }, [waqfId, causesVersion]);

  const activeCauses = causes.filter((c) => !c.deletedAt);
  const causeName = (id: string | null) => (id ? causes.find((c) => c.id === id)?.name ?? "—" : "—");

  return (
    <section>
      <NominationsQueue
        waqfId={waqfId}
        onDecided={() => {
          load();
          onChanged();
        }}
      />

      <SectionHeader
        title="Beneficiaries"
        description="People or groups eligible to receive distributions from this fund."
        actionLabel={showForm ? "Cancel" : "Add beneficiary"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load beneficiaries" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm && (
        <BeneficiaryForm
          waqfId={waqfId}
          causes={activeCauses}
          onCreated={() => {
            setShowForm(false);
            load();
            onChanged();
          }}
        />
      )}

      {!error && beneficiaries === null && <RowsSkeleton columns={6} />}

      {!error && beneficiaries !== null && beneficiaries.length === 0 && !showForm && (
        <EmptyState title="No beneficiaries registered yet" description="Add one above to start tracking eligibility." />
      )}

      {!error && beneficiaries !== null && beneficiaries.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Cause</TableHeaderCell>
              <TableHeaderCell>Eligibility criteria</TableHeaderCell>
              <TableHeaderCell>Contact</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {beneficiaries.map((b) => {
              const expired = b.eligibilityExpiresAt !== null && new Date(b.eligibilityExpiresAt) < new Date();
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-medium text-slate-900">
                    {b.name}
                    <Badge tone="neutral" className="ml-1.5">
                      {humanize(b.kind)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-500">{causeName(b.causeId)}</TableCell>
                  <TableCell className="max-w-xs truncate text-slate-500" title={b.eligibilityCriteria}>
                    {b.eligibilityCriteria}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {b.phone && <div>{b.phone}</div>}
                    {b.email && <div>{b.email}</div>}
                    {!b.phone && !b.email && "—"}
                  </TableCell>
                  <TableCell>
                    <Badge tone={b.status === "active" ? "success" : "neutral"}>{humanize(b.status)}</Badge>
                    {b.eligibilityExpiresAt && (
                      <p className={`mt-0.5 text-[11px] ${expired ? "text-red-600" : "text-slate-400"}`}>
                        {expired ? "expired" : "expires"} {formatDate(b.eligibilityExpiresAt)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1.5">
                      <StatusChangeAction beneficiary={b} onProposed={onChanged} />
                      <CriteriaUpdateAction beneficiary={b} onProposed={onChanged} />
                      <PayoutDetailsAction beneficiary={b} onSaved={load} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function BeneficiaryForm({
  waqfId,
  causes,
  onCreated,
}: {
  waqfId: string;
  causes: WaqfCause[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"individual" | "organization">("individual");
  const [causeId, setCauseId] = useState("");
  const [eligibilityCriteria, setEligibilityCriteria] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [eligibilityExpiresAt, setEligibilityExpiresAt] = useState("");
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [payoutProvider, setPayoutProvider] = useState<"paystack" | "stripe" | "stablecoin">("paystack");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!causeId) {
      setError("A cause is required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson("/beneficiaries", {
        method: "POST",
        body: JSON.stringify({
          waqfId,
          name,
          kind,
          causeId,
          eligibilityCriteria,
          phone: phone || undefined,
          email: email || undefined,
          eligibilityExpiresAt: eligibilityExpiresAt || undefined,
          payoutProvider: showBankDetails ? payoutProvider : undefined,
          bankDetails:
            showBankDetails && bankName && accountNumber && accountName
              ? { bankName, accountNumber, accountName, bankCode: bankCode || undefined }
              : undefined,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't add beneficiary">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "individual" | "organization")}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="individual">Individual</option>
            <option value="organization">Organization</option>
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
          <label className="text-sm font-medium text-slate-700">Eligibility criteria</label>
          <Input
            required
            placeholder='e.g. "Widowed, no income, 3 dependents"'
            value={eligibilityCriteria}
            onChange={(e) => setEligibilityCriteria(e.target.value)}
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
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Eligibility expires (optional)</label>
          <Input type="date" value={eligibilityExpiresAt} onChange={(e) => setEligibilityExpiresAt(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>

      {!showBankDetails ? (
        <button
          type="button"
          className="text-xs font-medium text-primary-700 hover:underline"
          onClick={() => setShowBankDetails(true)}
        >
          + Add bank details
        </button>
      ) : (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Bank details</p>
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
            <div className="min-w-[10rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Bank name</label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </div>
            <div className="min-w-[10rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Account number</label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </div>
            <div className="min-w-[10rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Account name</label>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </div>
            {payoutProvider === "paystack" && (
              <div className="min-w-[8rem] space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Bank code</label>
                <Input value={bankCode} onChange={(e) => setBankCode(e.target.value)} placeholder="e.g. 058" />
              </div>
            )}
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
          {payoutProvider === "paystack" && (
            <p className="mt-2 text-xs text-slate-500">
              A distribution to this beneficiary can only be approved once bank name, account number, account name,
              and bank code are all on file.
            </p>
          )}
        </div>
      )}
    </form>
  );
}

// Proposes beneficiary.status_change (governed_actions) rather than
// toggling status directly — see
// BeneficiariesService.updateStatus's own comment: this is a
// maker-checker action, same authority level as an eligibility-criteria
// change, not immediate staff CRUD.
function StatusChangeAction({ beneficiary, onProposed }: { beneficiary: Beneficiary; onProposed: () => void }) {
  const newStatus = beneficiary.status === "active" ? "inactive" : "active";
  return (
    <ProposeGovernedActionButton
      permissionKey="beneficiary.status_change"
      payload={{ beneficiaryId: beneficiary.id, newStatus }}
      label={newStatus === "inactive" ? "Disable" : "Enable"}
      onProposed={onProposed}
    />
  );
}

// Needs a value from staff (the new criteria text), unlike
// StatusChangeAction above — a small bespoke inline component, same
// shape as CausesSection.tsx's own ProceedsAllocationCell, rather than
// forcing this into the bare-click ProposeGovernedActionButton shape.
function CriteriaUpdateAction({ beneficiary, onProposed }: { beneficiary: Beneficiary; onProposed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [newCriteria, setNewCriteria] = useState(beneficiary.eligibilityCriteria);
  const [submitting, setSubmitting] = useState(false);
  const [proposed, setProposed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (proposed) {
    return <span className="text-xs text-slate-400">Criteria update pending approval</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-xs font-medium text-primary-700 hover:underline"
        onClick={() => {
          setNewCriteria(beneficiary.eligibilityCriteria);
          setError(null);
          setEditing(true);
        }}
      >
        Propose criteria update
      </button>
    );
  }

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({
          permissionKey: "beneficiary.criteria_update",
          payload: { beneficiaryId: beneficiary.id, newCriteria },
        }),
      });
      setEditing(false);
      setProposed(true);
      onProposed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handlePropose} className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Input
          required
          autoFocus
          className="w-40"
          value={newCriteria}
          onChange={(e) => setNewCriteria(e.target.value)}
        />
        <Button type="submit" disabled={submitting} className="px-2.5 py-1.5 text-xs">
          {submitting ? "Proposing…" : "Propose"}
        </Button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </form>
  );
}

// Not a governed action — plain staff CRUD, same posture as
// BeneficiaryForm's own bank-details fields at creation time (see
// BeneficiariesService.setPayoutDetails's own comment on why this
// exists: bankDetails/payoutProvider are both optional at creation, so
// this is the only way an already-registered beneficiary can ever
// become payout-ready). DistributionsService.assertPayoutReady is what
// actually gates whether a distribution can be approved — this just
// registers the details themselves.
function PayoutDetailsAction({ beneficiary, onSaved }: { beneficiary: Beneficiary; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [payoutProvider, setPayoutProvider] = useState<"paystack" | "stripe" | "stablecoin">(
    beneficiary.payoutProvider ?? "paystack",
  );
  const [bankName, setBankName] = useState(beneficiary.bankDetails?.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(beneficiary.bankDetails?.accountNumber ?? "");
  const [accountName, setAccountName] = useState(beneficiary.bankDetails?.accountName ?? "");
  const [bankCode, setBankCode] = useState(beneficiary.bankDetails?.bankCode ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPayoutReady = beneficiary.payoutProvider === "paystack" && Boolean(beneficiary.bankDetails?.bankCode);

  if (!editing) {
    return (
      <button
        type="button"
        className="text-xs font-medium text-primary-700 hover:underline"
        onClick={() => {
          setError(null);
          setEditing(true);
        }}
      >
        {isPayoutReady ? "Edit payout details" : "Add payout details"}
      </button>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/beneficiaries/${beneficiary.id}/payout-details`, {
        method: "POST",
        body: JSON.stringify({
          payoutProvider,
          bankDetails: { bankName, accountNumber, accountName, bankCode: bankCode || undefined },
        }),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="w-56 space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
      <select
        value={payoutProvider}
        onChange={(e) => setPayoutProvider(e.target.value as "paystack" | "stripe" | "stablecoin")}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        <option value="paystack">Paystack</option>
        <option value="stripe" disabled>
          Stripe (coming soon)
        </option>
        <option value="stablecoin" disabled>
          Stablecoin (coming soon)
        </option>
      </select>
      <Input className="text-xs" placeholder="Bank name" required value={bankName} onChange={(e) => setBankName(e.target.value)} />
      <Input
        className="text-xs"
        placeholder="Account number"
        required
        value={accountNumber}
        onChange={(e) => setAccountNumber(e.target.value)}
      />
      <Input
        className="text-xs"
        placeholder="Account name"
        required
        value={accountName}
        onChange={(e) => setAccountName(e.target.value)}
      />
      {payoutProvider === "paystack" && (
        <Input className="text-xs" placeholder="Bank code, e.g. 058" value={bankCode} onChange={(e) => setBankCode(e.target.value)} />
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting} className="px-2.5 py-1 text-xs">
          {submitting ? "Saving…" : "Save"}
        </Button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </form>
  );
}

/**
 * A Founder's proposals for this waqf's beneficiary list (see
 * app/(founder)/portfolio/[id]/BeneficiariesSection.tsx's nomination
 * form) — only rendered at all once there's at least one pending, same
 * "avoid permanent clutter" convention as
 * app/ops/cause-categories/page.tsx's CauseSuggestionsQueue. Unlike
 * that queue, approve/reject here aren't role-restricted — any staff
 * viewing this waqf can decide (see BeneficiaryNominationsService
 * .approve's own comment on why).
 */
function NominationsQueue({ waqfId, onDecided }: { waqfId: string; onDecided: () => void }) {
  const [nominations, setNominations] = useState<BeneficiaryNomination[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetchJson<BeneficiaryNomination[]>(`/beneficiary-nominations?waqfId=${waqfId}`)
      .then(setNominations)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = nominations?.filter((n) => n.status === "pending") ?? [];

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — this queue IS the content
  // beneficiary_nomination.pending's linkUrl points to.
  useEffect(() => {
    pending.forEach((n) => markNotificationsReadForEntity("BeneficiaryNomination", n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nominations]);

  if (!error && nominations !== null && pending.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="mb-1 text-sm font-medium text-slate-700">Beneficiary nominations</p>
      <p className="mb-3 text-xs text-slate-500">Proposed by Founders — review before they join the list below.</p>

      {error && (
        <Alert tone="danger" title="Couldn't load nominations" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && nominations === null && <RowsSkeleton columns={2} />}

      {!error && pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((n) => (
            <NominationRow
              key={n.id}
              nomination={n}
              onDecided={() => {
                load();
                onDecided();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NominationRow({ nomination, onDecided }: { nomination: BeneficiaryNomination; onDecided: () => void }) {
  const [mode, setMode] = useState<"reject" | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/beneficiary-nominations/${nomination.id}/approve`, { method: "POST" });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  async function submitReject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reviewNotes.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson(`/beneficiary-nominations/${nomination.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reviewNotes: reviewNotes.trim() }),
      });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">
            {nomination.name}
            <Badge tone="neutral" className="ml-1.5">
              {humanize(nomination.kind)}
            </Badge>
          </p>
          <p className="text-sm text-slate-600">{nomination.eligibilityCriteria}</p>
          {(nomination.phone || nomination.email) && (
            <p className="mt-0.5 text-xs text-slate-500">{[nomination.phone, nomination.email].filter(Boolean).join(" · ")}</p>
          )}
          {nomination.bankDetails && (
            <p className="mt-0.5 text-xs text-slate-500">
              Bank: {nomination.bankDetails.bankName} · {nomination.bankDetails.accountNumber} ({nomination.bankDetails.accountName})
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Proposed by {nomination.proposedByUser.fullName} ({nomination.proposedByFounder.name})
            {nomination.cause && <> for {nomination.cause.name}</>} · {formatDate(nomination.createdAt)}
          </p>
        </div>
        {mode === null && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={submitting} onClick={approve}>
              {submitting ? "Approving…" : "Approve"}
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setMode("reject")}>
              Reject
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't decide" className="mt-3">
          {error}
        </Alert>
      )}

      {mode === "reject" && (
        <form onSubmit={submitReject} className="mt-3 space-y-3 border-t border-accent-200 pt-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Reason (shown only internally)</label>
            <Input required value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} maxLength={500} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Rejecting…" : "Confirm reject"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
