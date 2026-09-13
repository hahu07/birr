"use client";

// Investment proceeds/returns — distinct from Investment.allocatedAmount
// (how much corpus sits in an instrument): this is the *return* that
// instrument produced. Recorded here as a staff performance/compliance
// record; the waqf's raised corpus (WaqfCausesService.allocate) still
// funds Causes exactly as before, unaffected by anything recorded here.
// What's recorded here is now itself a second, additive funding pool
// split across this waqf's Causes proportionally to their own corpus
// allocation — automatically, on every record() (see
// WaqfProceedsService.record's own comment) — or staff can still
// re-trigger/override the split manually via the Causes section's own
// "Auto-allocate proportionally" control (e.g. after adding a new
// cause). See WaqfCausesService.allocateProceedsProportionally's own
// comment. Append-only, same posture as CauseImpactUpdate: a correction is a new
// (possibly negative) entry, never an edit — so no edit/delete
// affordance here. Only shown for Investment-type waqfs (see the parent
// page's own gate).
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate } from "../../../../lib/format";
import type { Investment, WaqfProceeds } from "../../../../lib/ops-types";
import { Alert, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

export function ProceedsSection({
  waqfId,
  onChanged,
}: {
  waqfId: string;
  // Called after a proceeds record succeeds — the backend automatically
  // re-runs the proportional proceeds-allocation split across this
  // waqf's causes on every record() now (see WaqfProceedsService
  // .record's own comment), so the parent page needs to know to
  // refresh CausesSection's list.
  onChanged: () => void;
}) {
  const {
    data: proceeds,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<WaqfProceeds[]>(`/waqf-proceeds?waqfId=${waqfId}`), [waqfId]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiFetchJson<Investment[]>(`/investments?waqfId=${waqfId}`).then(setInvestments).catch(() => setInvestments([]));
  }, [waqfId]);

  const total = (proceeds ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <section>
      <SectionHeader
        title="Proceeds"
        description="Investment returns recorded over time — the corpus stays invested. Doesn't affect corpus-based Cause Allocation; automatically split across Causes proportionally, shown below."
        actionLabel={showForm ? "Cancel" : "Record proceeds"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load proceeds" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm && (
        <ProceedsForm
          waqfId={waqfId}
          investments={investments}
          onCreated={() => {
            setShowForm(false);
            load();
            onChanged();
          }}
        />
      )}

      {!error && proceeds === null && <RowsSkeleton columns={4} />}

      {!error && proceeds !== null && proceeds.length === 0 && !showForm && (
        <EmptyState title="No proceeds recorded yet" description="Record a return above once an investment generates income." />
      )}

      {!error && proceeds !== null && proceeds.length > 0 && (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Total recorded: <span className="font-medium text-slate-900">{formatAmount(total)}</span>
          </p>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Amount</TableHeaderCell>
                <TableHeaderCell>Investment</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
                <TableHeaderCell>Recorded</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {proceeds.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-slate-900">
                    {p.currency} {formatAmount(p.amount)}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {investments.find((i) => i.id === p.investmentId)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">{p.description}</TableCell>
                  <TableCell className="whitespace-nowrap text-slate-500">{formatDate(p.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}

function ProceedsForm({
  waqfId,
  investments,
  onCreated,
}: {
  waqfId: string;
  investments: Investment[];
  onCreated: () => void;
}) {
  const [investmentId, setInvestmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/waqf-proceeds", {
        method: "POST",
        body: JSON.stringify({ waqfId, investmentId: investmentId || undefined, amount, currency, description }),
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
        <Alert tone="danger" title="Couldn't record proceeds">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Investment (optional)</label>
          <select
            value={investmentId}
            onChange={(e) => setInvestmentId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">Not tied to one instrument</option>
            {investments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Amount</label>
          <Input type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="w-28 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Currency</label>
          <Input required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Description</label>
          <Input
            required
            placeholder="e.g. Q3 2026 sukuk return"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Recording…" : "Record"}
        </Button>
      </div>
    </form>
  );
}
