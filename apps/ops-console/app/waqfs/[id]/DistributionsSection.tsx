"use client";

// Distribution registration is plain CRUD (a draft payout) — approval is
// always a governed_actions distribution.approve action, handled on the
// Approval Queue page, never here. Requires an existing Cause and
// Beneficiary on this waqf; if neither exists yet, the form below says so
// rather than rendering empty selects.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import type { Beneficiary, Distribution, WaqfCause } from "../../../lib/types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../../_components/SectionChrome";

const STATUS_TONE: Record<Distribution["status"], "success" | "warning" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

export function DistributionsSection({
  waqfId,
  causesVersion,
  beneficiariesVersion,
}: {
  waqfId: string;
  causesVersion: number;
  beneficiariesVersion: number;
}) {
  const [distributions, setDistributions] = useState<Distribution[] | null>(null);
  const [causes, setCauses] = useState<WaqfCause[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<Distribution[]>(`/distributions?waqfId=${waqfId}`)
      .then(setDistributions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`).then(setCauses).catch(() => setCauses([]));
  }, [waqfId, causesVersion]);

  useEffect(() => {
    apiFetchJson<Beneficiary[]>(`/beneficiaries?waqfId=${waqfId}`)
      .then(setBeneficiaries)
      .catch(() => setBeneficiaries([]));
  }, [waqfId, beneficiariesVersion]);

  const causeName = (id: string) => causes.find((c) => c.id === id)?.name ?? "—";
  const beneficiaryName = (id: string) => beneficiaries.find((b) => b.id === id)?.name ?? "—";

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
        (causes.length === 0 || beneficiaries.length === 0 ? (
          <Alert tone="warning" title="Nothing to distribute to yet" className="mb-4">
            A distribution needs at least one Cause and one Beneficiary on this fund — add those first.
          </Alert>
        ) : (
          <DistributionForm
            waqfId={waqfId}
            causes={causes}
            beneficiaries={beneficiaries}
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        ))}

      {!error && distributions === null && <RowsSkeleton columns={4} />}

      {!error && distributions !== null && distributions.length === 0 && !showForm && (
        <EmptyState title="No distributions yet" description="Add one above once there's a beneficiary to pay out to." />
      )}

      {!error && distributions !== null && distributions.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Beneficiary</TableHeaderCell>
              <TableHeaderCell>Cause</TableHeaderCell>
              <TableHeaderCell>Amount</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {distributions.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium text-slate-900">{beneficiaryName(d.beneficiaryId)}</TableCell>
                <TableCell className="text-slate-500">{causeName(d.causeId)}</TableCell>
                <TableCell className="text-slate-500">{d.amount}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[d.status]}>{humanize(d.status)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function DistributionForm({
  waqfId,
  causes,
  beneficiaries,
  onCreated,
}: {
  waqfId: string;
  causes: WaqfCause[];
  beneficiaries: Beneficiary[];
  onCreated: () => void;
}) {
  const [causeId, setCauseId] = useState(causes[0]?.id ?? "");
  const [beneficiaryId, setBeneficiaryId] = useState(beneficiaries[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/distributions", {
        method: "POST",
        body: JSON.stringify({ waqfId, causeId, beneficiaryId, amount }),
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
        <div className="w-40 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Amount</label>
          <Input type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}
