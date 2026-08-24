"use client";

// Beneficiary registration is plain CRUD — eligibility-criteria changes
// are always a governed_actions beneficiary.criteria_update action,
// handled on the Approval Queue page, never here.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import type { Beneficiary, WaqfCause } from "../../../lib/types";
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
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`).then(setCauses).catch(() => setCauses([]));
  }, [waqfId, causesVersion]);

  const causeName = (id: string | null) => (id ? causes.find((c) => c.id === id)?.name ?? "—" : "—");

  return (
    <section>
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
          causes={causes}
          onCreated={() => {
            setShowForm(false);
            load();
            onChanged();
          }}
        />
      )}

      {!error && beneficiaries === null && <RowsSkeleton columns={3} />}

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
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {beneficiaries.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium text-slate-900">{b.name}</TableCell>
                <TableCell className="text-slate-500">{causeName(b.causeId)}</TableCell>
                <TableCell className="max-w-xs truncate text-slate-500" title={b.eligibilityCriteria}>
                  {b.eligibilityCriteria}
                </TableCell>
                <TableCell>
                  <Badge tone={b.status === "active" ? "success" : "neutral"}>{humanize(b.status)}</Badge>
                </TableCell>
              </TableRow>
            ))}
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
  const [causeId, setCauseId] = useState("");
  const [eligibilityCriteria, setEligibilityCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/beneficiaries", {
        method: "POST",
        body: JSON.stringify({ waqfId, name, eligibilityCriteria, causeId: causeId || undefined }),
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
          <label className="text-sm font-medium text-slate-700">Cause (optional)</label>
          <select
            value={causeId}
            onChange={(e) => setCauseId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">None</option>
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
            value={eligibilityCriteria}
            onChange={(e) => setEligibilityCriteria(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}
