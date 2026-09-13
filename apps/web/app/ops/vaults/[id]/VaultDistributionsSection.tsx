"use client";

// Distribution registration is plain CRUD (a draft payout to a
// Counterparty, not an individual beneficiary — see the plan's own
// "payouts go to Counterparty" framing decision) — approval is always
// the vault.distribution_approve governed action, decided on the
// Approval Queue page (never here).
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, humanize } from "../../../../lib/format";
import type { Counterparty, VaultCause, VaultDistribution, VaultMilestone } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";

const STATUS_TONE: Record<VaultDistribution["status"], "success" | "warning" | "danger"> = {
  pending: "warning",
  approved: "warning",
  disbursing: "warning",
  paid: "success",
  payout_failed: "danger",
  rejected: "danger",
};

export function VaultDistributionsSection({
  vaultId,
  currency,
  causes,
  milestones,
}: {
  vaultId: string;
  currency: string;
  causes: VaultCause[];
  // Project vaults only — see VaultMilestone's own schema comment.
  // Empty for an investment vault, which simply never shows the
  // milestone picker below.
  milestones: VaultMilestone[];
}) {
  const {
    data: distributions,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<VaultDistribution[]>(`/vault-distributions?vaultId=${vaultId}`), [vaultId]);
  const [activeCounterparties, setActiveCounterparties] = useState<Counterparty[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiFetchJson<Counterparty[]>("/counterparties?status=active")
      .then(setActiveCounterparties)
      .catch(() => setActiveCounterparties([]));
  }, []);

  const causeName = (id: string) => causes.find((c) => c.id === id)?.name ?? "—";
  const counterpartyName = (id: string) => activeCounterparties.find((c) => c.id === id)?.name ?? "—";
  const milestoneName = (id: string | null) => (id ? (milestones.find((m) => m.id === id)?.name ?? "—") : null);

  return (
    <section>
      <SectionHeader
        title="Distributions"
        description="Draft payouts to a relief/delivery partner — approving one is a maker-checker decision on the Approval Queue."
        actionLabel={showForm ? "Cancel" : "Add distribution"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load distributions" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm &&
        (causes.length === 0 || activeCounterparties.length === 0 ? (
          <Alert tone="warning" title="Nothing to distribute to yet" className="mb-4">
            A distribution needs at least one Cause on this vault and one active Counterparty — add those first.
          </Alert>
        ) : (
          <DistributionForm
            vaultId={vaultId}
            currency={currency}
            causes={causes}
            counterparties={activeCounterparties}
            milestones={milestones}
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        ))}

      {!error && distributions === null && <RowsSkeleton columns={5} />}

      {!error && distributions !== null && distributions.length === 0 && !showForm && (
        <EmptyState title="No distributions yet" description="Add one above once there's a partner to pay out to." />
      )}

      {!error && distributions !== null && distributions.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Counterparty</TableHeaderCell>
              <TableHeaderCell>Cause</TableHeaderCell>
              {milestones.length > 0 && <TableHeaderCell>Milestone</TableHeaderCell>}
              <TableHeaderCell>Amount</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {distributions.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium text-slate-900">{counterpartyName(d.counterpartyId)}</TableCell>
                <TableCell className="text-slate-500">{causeName(d.vaultCauseId)}</TableCell>
                {milestones.length > 0 && (
                  <TableCell className="text-slate-500">{milestoneName(d.vaultMilestoneId) ?? "—"}</TableCell>
                )}
                <TableCell className="text-slate-500">
                  {formatAmount(d.amount)} {d.currency}
                </TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[d.status]}>{humanize(d.status)}</Badge>
                  {d.status === "payout_failed" && d.payoutError && (
                    <p className="mt-1 max-w-[16rem] text-xs text-red-600">{d.payoutError}</p>
                  )}
                </TableCell>
                <TableCell>
                  {d.status === "pending" && (
                    <ProposeGovernedActionButton
                      permissionKey="vault.distribution_approve"
                      payload={{ vaultDistributionId: d.id }}
                      label="Propose approval"
                      onProposed={load}
                    />
                  )}
                  {d.status === "payout_failed" && <RetryDisbursementAction distributionId={d.id} onRetried={load} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// No maker-checker gate here (unlike ProposeGovernedActionButton above)
// — the governance decision already happened at
// vault.distribution_approve; this is purely payment-mechanics retry
// against an already-final decision. Mirrors DistributionsSection.tsx's
// own RetryDisbursementAction exactly.
function RetryDisbursementAction({ distributionId, onRetried }: { distributionId: string; onRetried: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/vault-distributions/${distributionId}/retry-disbursement`, { method: "POST" });
      onRetried();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={submitting} onClick={retry}>
        {submitting ? "Retrying…" : "Retry disbursement"}
      </Button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

function DistributionForm({
  vaultId,
  currency,
  causes,
  counterparties,
  milestones,
  onCreated,
}: {
  vaultId: string;
  currency: string;
  causes: VaultCause[];
  counterparties: Counterparty[];
  milestones: VaultMilestone[];
  onCreated: () => void;
}) {
  const [vaultCauseId, setVaultCauseId] = useState(causes[0]?.id ?? "");
  const [counterpartyId, setCounterpartyId] = useState(counterparties[0]?.id ?? "");
  const [vaultMilestoneId, setVaultMilestoneId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a completed milestone can actually be attached — see
  // VaultDistributionsService.create()'s own gate (it flatly rejects a
  // non-completed one). Filtering here means the dropdown never offers
  // a choice that's guaranteed to fail; an incomplete milestone simply
  // isn't a distribution option yet.
  const completedMilestones = milestones.filter((m) => m.status === "completed");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/vault-distributions", {
        method: "POST",
        body: JSON.stringify({ vaultId, vaultCauseId, counterpartyId, vaultMilestoneId: vaultMilestoneId || undefined, amount, currency }),
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
        <Alert tone="danger" title="Couldn't add distribution">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Counterparty</label>
          <select
            value={counterpartyId}
            onChange={(e) => setCounterpartyId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {counterparties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Cause</label>
          <select
            value={vaultCauseId}
            onChange={(e) => setVaultCauseId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {causes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {milestones.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Milestone tranche (optional)</label>
            <select
              value={vaultMilestoneId}
              onChange={(e) => setVaultMilestoneId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">Ad-hoc (no milestone)</option>
              {completedMilestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {completedMilestones.length === 0 && (
              <p className="text-xs text-slate-500">No milestone is completed yet — propose one's completion first.</p>
            )}
          </div>
        )}
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Amount ({currency})</label>
          <Input type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}
