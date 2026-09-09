"use client";

// Causes are the theme/purpose buckets within one Waqf Fund (e.g. an
// "Education Fund" waqf might have "Scholarships" and "School Supplies"
// causes) — Beneficiaries and Distributions both reference one, so this
// section sits first and hands its list up to the page via onChanged.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate } from "../../../../lib/format";
import type { Waqf, WaqfCause, WaqfProceeds } from "../../../../lib/ops-types";
import { Alert, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../../_components/SectionChrome";

export function CausesSection({
  waqfId,
  waqfType,
  corpusCurrency,
  onChanged,
  proceedsVersion,
}: {
  waqfId: string;
  waqfType: Waqf["type"];
  // Every amount on this page is denominated in the waqf's own declared
  // corpus currency (WaqfCause carries no currency of its own — see that
  // model's schema comment) — same prop the founder-side sibling of this
  // component already receives and displays.
  corpusCurrency: string | null;
  onChanged: () => void;
  // Bumped by ProceedsSection whenever it records a new proceeds entry
  // — the backend now automatically re-runs the proportional
  // proceeds-allocation split on every record() (see
  // WaqfProceedsService.record's own comment), so this list needs to
  // refetch to pick up each cause's freshly recomputed
  // proceedsAllocatedAmount without a manual page reload.
  proceedsVersion: number;
}) {
  const [causes, setCauses] = useState<WaqfCause[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Only an Investment-type waqf can ever have recorded WaqfProceeds
  // (WaqfProceedsService.record rejects every other type) — the
  // "Proceeds allocated" column/control only make sense here.
  const showProceeds = waqfType === "investment";
  const [proceedsTotal, setProceedsTotal] = useState<number | null>(null);

  const load = useCallback(() => {
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`)
      .then(setCauses)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load, proceedsVersion]);

  useEffect(() => {
    if (!showProceeds) return;
    apiFetchJson<WaqfProceeds[]>(`/waqf-proceeds?waqfId=${waqfId}`)
      .then((rows) => setProceedsTotal(rows.reduce((sum, p) => sum + Number(p.amount), 0)))
      .catch(() => setProceedsTotal(null));
  }, [waqfId, showProceeds]);

  // How much of the waqf's recorded proceeds pool is still unallocated
  // across every cause other than the one being edited — mirrors
  // WaqfCausesService.allocateProceeds's own "pool minus siblings"
  // check, computed client-side purely as a helpful hint (the server
  // re-validates for real on submit).
  const proceedsAvailableExcluding = useCallback(
    (causeId: string) => {
      if (proceedsTotal === null || !causes) return null;
      const allocatedToOthers = causes
        .filter((c) => c.id !== causeId)
        .reduce((sum, c) => sum + Number(c.proceedsAllocatedAmount ?? 0), 0);
      return proceedsTotal - allocatedToOthers;
    },
    [proceedsTotal, causes],
  );

  return (
    <section>
      <SectionHeader
        title="Causes"
        description="Themes within this fund — Beneficiaries and Distributions are tracked against one."
        actionLabel={showForm ? "Cancel" : "Add cause"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load causes" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm && (
        <CauseForm
          waqfId={waqfId}
          onCreated={() => {
            setShowForm(false);
            load();
            onChanged();
          }}
        />
      )}

      {showProceeds && !error && causes !== null && causes.length > 0 && (
        <AutoAllocateProportionallyBar
          waqfId={waqfId}
          causes={causes}
          proceedsTotal={proceedsTotal}
          corpusCurrency={corpusCurrency}
          onAllocated={() => {
            load();
            onChanged();
          }}
        />
      )}

      {!error && causes === null && <RowsSkeleton columns={showProceeds ? 5 : 4} />}

      {!error && causes !== null && causes.length === 0 && !showForm && (
        <EmptyState title="No causes yet" description="Add one above to start tracking beneficiaries against it." />
      )}

      {!error && causes !== null && causes.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Description</TableHeaderCell>
              <TableHeaderCell>Allocated</TableHeaderCell>
              {showProceeds && <TableHeaderCell>Proceeds allocated</TableHeaderCell>}
              <TableHeaderCell className="text-right">Added</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {causes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-slate-900">{c.name}</TableCell>
                <TableCell className="text-slate-500">{c.description ?? "—"}</TableCell>
                {/* Founder self-service (see WaqfCausesService.allocate's
                    own comment) — read-only here, no staff write path. */}
                <TableCell className="text-slate-500">
                  {c.allocatedAmount !== null ? `${corpusCurrency ?? ""} ${formatAmount(c.allocatedAmount)}` : "—"}
                </TableCell>
                {showProceeds && (
                  <TableCell className="text-slate-500">
                    <ProceedsAllocationCell
                      cause={c}
                      available={proceedsAvailableExcluding(c.id)}
                      corpusCurrency={corpusCurrency}
                      onChanged={() => {
                        load();
                        onChanged();
                      }}
                    />
                  </TableCell>
                )}
                <TableCell className="text-right text-slate-500">{formatDate(c.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// Bulk alternative to setting each cause's "Proceeds allocated" one at
// a time — auto-splits the recorded proceeds pool across every cause
// proportional to its own corpus allocation (see
// WaqfCausesService.allocateProceedsProportionally's own comment: N
// raised, 60%/40% corpus split → any proceeds split the same way).
// Still staff-triggered, not automatic on every proceeds record —
// clicking recomputes and overwrites every cause's current "Proceeds
// allocated" figure from scratch, it doesn't top up.
function AutoAllocateProportionallyBar({
  waqfId,
  causes,
  proceedsTotal,
  corpusCurrency,
  onAllocated,
}: {
  waqfId: string;
  causes: WaqfCause[];
  proceedsTotal: number | null;
  corpusCurrency: string | null;
  onAllocated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCorpusAllocated = causes.reduce((sum, c) => sum + Number(c.allocatedAmount ?? 0), 0);

  if (proceedsTotal === null || proceedsTotal <= 0 || totalCorpusAllocated <= 0) return null;

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/waqf-causes/allocate-proceeds-proportionally", {
        method: "POST",
        body: JSON.stringify({ waqfId }),
      });
      setExpanded(false);
      onAllocated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          The {corpusCurrency} {formatAmount(proceedsTotal)} recorded proceeds pool is split by each cause's own
          corpus allocation ratio automatically whenever proceeds are recorded — use this to re-run it by hand (e.g.
          after adding a new cause).
        </p>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-primary-700 hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide preview" : "Re-run allocation"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          {error && (
            <Alert tone="danger" title="Couldn't allocate">
              {error}
            </Alert>
          )}
          <ul className="space-y-0.5 text-xs text-slate-600">
            {causes.map((c) => {
              const weight = Number(c.allocatedAmount ?? 0);
              const share = (weight / totalCorpusAllocated) * proceedsTotal;
              return (
                <li key={c.id} className="flex items-center justify-between">
                  <span>
                    {c.name} ({((weight / totalCorpusAllocated) * 100).toFixed(1)}% of corpus)
                  </span>
                  <span className="font-medium text-slate-900">
                    {corpusCurrency} {formatAmount(share)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-slate-500">
            Estimate — the server splits to the exact cent, this may differ by a cent from what's shown here.
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={submitting} onClick={handleConfirm} className="px-3 py-1.5 text-xs">
              {submitting ? "Allocating…" : "Confirm — overwrite every cause's split"}
            </Button>
            <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setExpanded(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Birr-staff control — see WaqfCausesService.allocateProceeds's own
// comment for why this is staff-set (unlike the read-only "Allocated"
// corpus column, which stays Founder self-service). "available" mirrors
// the server's own pool-minus-siblings check, purely as a UI hint; the
// server re-validates for real on submit.
function ProceedsAllocationCell({
  cause,
  available,
  corpusCurrency,
  onChanged,
}: {
  cause: WaqfCause;
  available: number | null;
  corpusCurrency: string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(cause.proceedsAllocatedAmount ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span>
          {cause.proceedsAllocatedAmount !== null ? `${corpusCurrency ?? ""} ${formatAmount(cause.proceedsAllocatedAmount)}` : "—"}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-primary-700 hover:underline"
          onClick={() => {
            setAmount(cause.proceedsAllocatedAmount ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          Set
        </button>
      </div>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/waqf-causes/${cause.id}/allocate-proceeds`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          autoFocus
          className="w-28"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button type="submit" disabled={submitting} className="px-2.5 py-1.5 text-xs">
          {submitting ? "Saving…" : "Save"}
        </Button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {available !== null && (
        <p className="text-[11px] text-slate-500">
          {corpusCurrency} {formatAmount(Math.max(available, 0))} available
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

function CauseForm({ waqfId, onCreated }: { waqfId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/waqf-causes", {
        method: "POST",
        body: JSON.stringify({ waqfId, name, description: description || undefined }),
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
        <Alert tone="danger" title="Couldn't add cause">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-[16rem] flex-[2] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Description (optional)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}
