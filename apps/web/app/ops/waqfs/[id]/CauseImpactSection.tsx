"use client";

// A periodic, staff-entered record of what a cause has actually
// achieved — CLAUDE.md lists impact measurement as a real waqf
// lifecycle stage; this is that. Append-only (no edit/delete route —
// see CauseImpactUpdate's own schema comment): a correction is a new
// entry, not an edit. Needs at least one Cause to exist first, same
// prerequisite Beneficiaries/Distributions already have.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import type { CauseImpactUpdate, WaqfCause } from "../../../../lib/ops-types";
import { Alert, Button, EmptyState, Input, StatCard } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../../_components/SectionChrome";

export function CauseImpactSection({ waqfId, causesVersion }: { waqfId: string; causesVersion: number }) {
  const [causes, setCauses] = useState<WaqfCause[]>([]);
  const [selectedCauseId, setSelectedCauseId] = useState("");
  const [updates, setUpdates] = useState<CauseImpactUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`)
      .then((data) => {
        setCauses(data);
        setSelectedCauseId((prev) => prev || data[0]?.id || "");
      })
      .catch(() => setCauses([]));
  }, [waqfId, causesVersion]);

  const load = useCallback(() => {
    if (!selectedCauseId) {
      setUpdates([]);
      return;
    }
    apiFetchJson<CauseImpactUpdate[]>(`/cause-impact-updates?waqfCauseId=${selectedCauseId}`)
      .then(setUpdates)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [selectedCauseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (causes.length === 0) return null; // nothing to report impact against yet

  return (
    <section>
      <SectionHeader
        title="Cause Impact"
        description="Periodic reporting on what each cause has actually achieved."
        actionLabel={showForm ? "Cancel" : "Log update"}
        onAction={() => setShowForm((v) => !v)}
      />

      <div className="mb-4 space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Cause</label>
        <select
          value={selectedCauseId}
          onChange={(e) => {
            setSelectedCauseId(e.target.value);
            setUpdates(null);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {causes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't load impact updates" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm && (
        <ImpactUpdateForm
          waqfCauseId={selectedCauseId}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {!error && updates === null && <RowsSkeleton columns={2} />}

      {!error && updates !== null && updates.length === 0 && !showForm && (
        <EmptyState title="No impact reported yet for this cause" description="Log the first update above." />
      )}

      {!error && updates !== null && updates.length > 0 && (
        <div className="space-y-3">
          {updates.map((u) => (
            <div key={u.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{u.periodLabel}</p>
                  <p className="mt-1 text-sm text-slate-600">{u.narrative}</p>
                </div>
                {u.metricValue !== null && (
                  <StatCard label={u.metricLabel ?? "Reported"} value={u.metricValue} tone="primary" />
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Reported by {u.reportedByUser.fullName} · {formatDate(u.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ImpactUpdateForm({ waqfCauseId, onCreated }: { waqfCauseId: string; onCreated: () => void }) {
  const [periodLabel, setPeriodLabel] = useState("");
  const [narrative, setNarrative] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [metricLabel, setMetricLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/cause-impact-updates", {
        method: "POST",
        body: JSON.stringify({
          waqfCauseId,
          periodLabel,
          narrative,
          metricValue: metricValue.trim() ? Number(metricValue) : undefined,
          metricLabel: metricLabel.trim() || undefined,
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
        <Alert tone="danger" title="Couldn't log update">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Period</label>
          <Input required placeholder="Q1 2026" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} maxLength={40} />
        </div>
        <div className="min-w-[16rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Narrative</label>
          <Input
            required
            placeholder='e.g. "120 families received food packages this quarter"'
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="w-28 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Metric (optional)</label>
          <Input type="number" min="0" value={metricValue} onChange={(e) => setMetricValue(e.target.value)} />
        </div>
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Metric unit</label>
          <Input placeholder="students" value={metricLabel} onChange={(e) => setMetricLabel(e.target.value)} maxLength={40} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Logging…" : "Log"}
        </Button>
      </div>
    </form>
  );
}
