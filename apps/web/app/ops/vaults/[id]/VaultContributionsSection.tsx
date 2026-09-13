"use client";

// Every contribution to one vault, plus the in-platform hold/refund
// workflow (owner's explicit decision, 2026-09-11) — replacing "staff
// fix a bad payment manually through Stripe's/Paystack's own dashboard"
// with an auditable record inside Birr's own system. Hold/release are
// plain, compliance-gated CRUD (flagging a payment for review moves no
// money); refunding one is always the governed vault.contribution_refund
// action, proposed here and decided on the Approval Queue page, never
// here — same posture as every other Vault money-moving action.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import type { VaultContribution } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";

export function VaultContributionsSection({ vaultId, currency }: { vaultId: string; currency: string }) {
  const {
    data: contributions,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<VaultContribution[]>(`/vault-contributions?vaultId=${vaultId}`), [vaultId]);

  return (
    <section>
      <SectionHeader
        title="Contributions"
        description="Every gift to this vault. Holding one flags it for review without moving money; refunding one always goes through a governed approval."
      />

      {error && (
        <Alert tone="danger" title="Couldn't load contributions" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && contributions === null && <RowsSkeleton columns={5} />}

      {!error && contributions !== null && contributions.length === 0 && (
        <EmptyState title="No contributions yet" description="They'll show up here once someone gives to this vault." />
      )}

      {!error && contributions !== null && contributions.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Donor</TableHeaderCell>
              <TableHeaderCell>Amount</TableHeaderCell>
              <TableHeaderCell>Provider</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Date</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {contributions.map((c) => (
              <ContributionRow key={c.id} contribution={c} currency={currency} onChanged={load} />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

const STATUS_TONE: Record<VaultContribution["status"], "success" | "warning" | "danger"> = {
  pending: "warning",
  confirmed: "success",
  failed: "danger",
};

function ContributionRow({
  contribution: c,
  currency,
  onChanged,
}: {
  contribution: VaultContribution;
  currency: string;
  onChanged: () => void;
}) {
  const [showHoldForm, setShowHoldForm] = useState(false);

  return (
    <TableRow>
      <TableCell className="text-slate-500">
        {c.donor ? c.donor.fullName ?? c.donor.email : <span className="italic text-slate-400">Anonymous</span>}
      </TableCell>
      <TableCell className="font-medium text-slate-900">
        {c.currency} {formatAmount(c.amount)}
      </TableCell>
      <TableCell className="text-slate-500">{humanize(c.provider)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[c.status]}>{humanize(c.status)}</Badge>
          {c.heldAt && <Badge tone="warning">Held</Badge>}
          {c.refundStatus && <Badge tone={c.refundStatus === "refunded" ? "success" : c.refundStatus === "failed" ? "danger" : "warning"}>{humanize(c.refundStatus)}</Badge>}
        </div>
        {c.heldReason && <p className="mt-1 max-w-[16rem] text-xs text-slate-500">{c.heldReason}</p>}
        {c.refundFailedReason && <p className="mt-1 max-w-[16rem] text-xs text-red-600">{c.refundFailedReason}</p>}
      </TableCell>
      <TableCell className="text-slate-500">{formatDate(c.createdAt)}</TableCell>
      <TableCell>
        <div className="flex flex-col items-end gap-1.5">
          {c.status === "confirmed" && !c.heldAt && !c.refundStatus && (
            <>
              {!showHoldForm ? (
                <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => setShowHoldForm(true)}>
                  Hold for review
                </button>
              ) : (
                <HoldForm contributionId={c.id} onDone={() => { setShowHoldForm(false); onChanged(); }} onCancel={() => setShowHoldForm(false)} />
              )}
            </>
          )}
          {c.heldAt && !c.refundStatus && <ReleaseButton contributionId={c.id} onReleased={onChanged} />}
          {c.status === "confirmed" && !c.refundStatus && (
            <ProposeGovernedActionButton
              permissionKey="vault.contribution_refund"
              payload={{ vaultContributionId: c.id }}
              label="Propose refund"
              onProposed={onChanged}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function HoldForm({ contributionId, onDone, onCancel }: { contributionId: string; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/vault-contributions/${contributionId}/hold`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-48 space-y-1.5 text-left">
      <Input required autoFocus placeholder="Reason for holding" value={reason} onChange={(e) => setReason(e.target.value)} className="text-xs" />
      <div className="flex gap-1.5">
        <Button type="submit" disabled={submitting} className="px-2.5 py-1 text-xs">
          {submitting ? "Holding…" : "Hold"}
        </Button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </form>
  );
}

function ReleaseButton({ contributionId, onReleased }: { contributionId: string; onReleased: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRelease() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/vault-contributions/${contributionId}/release`, { method: "POST" });
      onReleased();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="secondary" disabled={submitting} onClick={handleRelease} className="px-2.5 py-1.5 text-xs">
        {submitting ? "Releasing…" : "Release hold"}
      </Button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
