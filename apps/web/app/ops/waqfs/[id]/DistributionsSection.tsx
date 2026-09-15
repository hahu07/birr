"use client";

// Distribution registration is plain CRUD (a draft payout) — approval is
// always a governed_actions distribution.approve action, decided on the
// Approval Queue page (never here). Propose control is the "Propose
// approval" button per pending-status row below. Requires an existing
// Cause and Beneficiary on this waqf; if neither exists yet, the form
// below says so rather than rendering empty selects.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, humanize } from "../../../../lib/format";
import type { Beneficiary, Distribution, DistributionCauseSummary, WaqfCause, WaqfMilestone } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, StatCard, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";

const STATUS_TONE: Record<Distribution["status"], "success" | "warning" | "danger"> = {
  pending: "warning",
  // Approved-but-not-yet-disbursed is still in-flight, not a settled
  // success — "approved" no longer means money moved, see
  // Distribution["status"]'s own comment in lib/ops-types.ts.
  approved: "warning",
  disbursing: "warning",
  paid: "success",
  payout_failed: "danger",
  rejected: "danger",
};

// Matches the currencies actually accepted across every payment rail —
// see WaqfFundForm.tsx's own PROVIDERS list, which this flattens.
const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "USDC", "USDT"] as const;

export function DistributionsSection({
  waqfId,
  causesVersion,
  beneficiariesVersion,
  milestones = [],
}: {
  waqfId: string;
  causesVersion: number;
  beneficiariesVersion: number;
  // Project-type waqfs only — see WaqfMilestone's own schema comment.
  // Empty (the default) for every other type, which simply never shows
  // the milestone picker/column below.
  milestones?: WaqfMilestone[];
}) {
  const {
    data: distributions,
    error,
    reload: reloadDistributions,
  } = useLoadedResource(() => apiFetchJson<Distribution[]>(`/distributions?waqfId=${waqfId}`), [waqfId]);
  // Separate hook instance, separate failure mode — a broken rollup
  // shouldn't block the (more important) raw distributions list from
  // rendering, so its own fetch failure is swallowed to an empty list
  // rather than surfaced as this section's error.
  const { data: summary, reload: reloadSummary } = useLoadedResource(
    () => apiFetchJson<DistributionCauseSummary[]>(`/distributions/summary?waqfId=${waqfId}`).catch(() => []),
    [waqfId],
  );
  const load = useCallback(() => {
    reloadDistributions();
    reloadSummary();
  }, [reloadDistributions, reloadSummary]);
  const [causes, setCauses] = useState<WaqfCause[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    // includeInactive=true — a past distribution can reference a cause the
    // founder has since unselected; causeName() below still needs to
    // resolve it. activeCauses (derived below) is what the "add
    // distribution" form actually offers, so a founder can't be paid out
    // against a cause they no longer have selected.
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}&includeInactive=true`)
      .then(setCauses)
      .catch(() => setCauses([]));
  }, [waqfId, causesVersion]);

  useEffect(() => {
    apiFetchJson<Beneficiary[]>(`/beneficiaries?waqfId=${waqfId}`)
      .then(setBeneficiaries)
      .catch(() => setBeneficiaries([]));
  }, [waqfId, beneficiariesVersion]);

  const activeCauses = causes.filter((c) => !c.deletedAt);
  const causeName = (id: string) => causes.find((c) => c.id === id)?.name ?? "—";
  const beneficiaryName = (id: string) => beneficiaries.find((b) => b.id === id)?.name ?? "—";
  const milestoneName = (id: string | null) => (id ? (milestones.find((m) => m.id === id)?.name ?? "—") : null);

  return (
    <section>
      <SectionHeader
        title="Distributions"
        description="Draft payouts to a beneficiary — approving one is a maker-checker decision on the Approval Queue."
        actionLabel={showForm ? "Cancel" : "Add distribution"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load distributions" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm &&
        (activeCauses.length === 0 || beneficiaries.length === 0 ? (
          <Alert tone="warning" title="Nothing to distribute to yet" className="mb-4">
            A distribution needs at least one Cause and one Beneficiary on this fund — add those first.
          </Alert>
        ) : (
          <DistributionForm
            waqfId={waqfId}
            causes={activeCauses}
            beneficiaries={beneficiaries}
            milestones={milestones}
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        ))}

      {!error && summary !== null && summary.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {summary.map((s) => (
            <div key={`${s.causeId}-${s.currency}`}>
              <StatCard label={`${s.causeName} (${s.currency})`} value={s.totalAmount} tone="primary" />
              {s.beneficiaryNames && s.beneficiaryNames.length > 0 && (
                <p
                  className="mt-1 truncate px-0.5 text-[11px] text-slate-500"
                  title={s.beneficiaryNames.join(", ")}
                >
                  Paid to {s.beneficiaryNames.join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {!error && distributions === null && <RowsSkeleton columns={5} />}

      {!error && distributions !== null && distributions.length === 0 && !showForm && (
        <EmptyState title="No distributions yet" description="Add one above once there's a beneficiary to pay out to." />
      )}

      {!error && distributions !== null && distributions.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Beneficiary</TableHeaderCell>
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
                <TableCell className="font-medium text-slate-900">{beneficiaryName(d.beneficiaryId)}</TableCell>
                <TableCell className="text-slate-500">{causeName(d.causeId)}</TableCell>
                {milestones.length > 0 && (
                  <TableCell className="text-slate-500">{milestoneName(d.waqfMilestoneId) ?? "—"}</TableCell>
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
                      permissionKey="distribution.approve"
                      payload={{ distributionId: d.id }}
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
// — the governance decision already happened at distribution.approve;
// this is purely payment-mechanics retry against an already-final
// decision, calling POST /distributions/:id/retry-disbursement directly
// rather than proposing a new governed action.
function RetryDisbursementAction({ distributionId, onRetried }: { distributionId: string; onRetried: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/distributions/${distributionId}/retry-disbursement`, { method: "POST" });
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
  waqfId,
  causes,
  beneficiaries,
  milestones,
  onCreated,
}: {
  waqfId: string;
  causes: WaqfCause[];
  beneficiaries: Beneficiary[];
  milestones: WaqfMilestone[];
  onCreated: () => void;
}) {
  const [causeId, setCauseId] = useState(causes[0]?.id ?? "");
  const [beneficiaryId, setBeneficiaryId] = useState(beneficiaries[0]?.id ?? "");
  const [waqfMilestoneId, setWaqfMilestoneId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a completed milestone can actually be attached — see
  // DistributionsService.create()'s own gate (it flatly rejects a
  // non-completed one). Filtering here means the dropdown never offers
  // a choice that's guaranteed to fail.
  const completedMilestones = milestones.filter((m) => m.status === "completed");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/distributions", {
        method: "POST",
        body: JSON.stringify({ waqfId, causeId, beneficiaryId, waqfMilestoneId: waqfMilestoneId || undefined, amount, currency }),
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
          <label className="text-sm font-medium text-slate-700">Beneficiary</label>
          <select
            value={beneficiaryId}
            onChange={(e) => setBeneficiaryId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {beneficiaries.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Cause</label>
          <select
            value={causeId}
            onChange={(e) => setCauseId(e.target.value)}
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
              value={waqfMilestoneId}
              onChange={(e) => setWaqfMilestoneId(e.target.value)}
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
          <label className="text-sm font-medium text-slate-700">Amount</label>
          <Input type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}
