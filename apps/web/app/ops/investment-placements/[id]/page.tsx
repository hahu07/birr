"use client";

// One real-world counterparty placement's fund-by-fund breakdown, plus
// recording a return on it — split pro-rata across every contributing
// waqf's own WaqfProceeds server-side (InvestmentPlacementsService.
// recordProceeds, largest-remainder method) instead of an officer
// hand-calculating each fund's share. The preview below is an
// approximation for the officer's benefit only — the server's split is
// the actual source of truth and may differ by a cent from this preview
// on funds with the largest fractional remainder.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import type { InvestmentPlacementDetail } from "../../../../lib/ops-types";
import { Alert, Button, Card, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";

export default function InvestmentPlacementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [placement, setPlacement] = useState<InvestmentPlacementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProceedsForm, setShowProceedsForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<InvestmentPlacementDetail>(`/investment-placements/${id}`)
      .then(setPlacement)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this placement">
        {error}
      </Alert>
    );
  }

  if (!placement) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const activeInvestments = placement.investments.filter((i) => i.status === "active");
  const total = activeInvestments.reduce((sum, i) => sum + Number(i.allocatedAmount), 0);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/ops/counterparties/${placement.counterpartyId}`}
        className="text-sm font-medium text-primary-700 hover:text-primary-800"
      >
        ← {placement.counterparty.name}
      </Link>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{placement.name}</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {humanize(placement.instrumentType)} · {placement.counterparty.name} · placed {formatDate(placement.createdAt)}
        </p>
      </header>

      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">
            {formatAmount(total)} across {activeInvestments.length} fund{activeInvestments.length === 1 ? "" : "s"}
          </p>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setShowProceedsForm((v) => !v)}>
            {showProceedsForm ? "Cancel" : "Record proceeds for this placement"}
          </Button>
        </div>

        {showProceedsForm && (
          <RecordProceedsForm
            placementId={placement.id}
            investments={activeInvestments}
            onRecorded={() => {
              setShowProceedsForm(false);
              load();
            }}
          />
        )}

        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Fund</TableHeaderCell>
              <TableHeaderCell>Foundation</TableHeaderCell>
              <TableHeaderCell>Allocated amount</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {placement.investments.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium text-slate-900">
                  <Link href={`/ops/waqfs/${i.waqf.id}`} className="hover:text-primary-700">
                    {i.waqf.name}
                  </Link>
                </TableCell>
                <TableCell className="text-slate-500">{i.waqf.foundation.name}</TableCell>
                <TableCell className="text-slate-500">{formatAmount(i.allocatedAmount)}</TableCell>
                <TableCell className="text-slate-500">{humanize(i.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {new Set(placement.investments.map((i) => i.waqf.foundation.id)).size > 1 && (
          <p className="mt-3 text-xs text-slate-400">
            This placement pools money from {new Set(placement.investments.map((i) => i.waqf.foundation.id)).size}{" "}
            different Foundations — each fund's own share stays attributed to its own Foundation above; nothing here
            merges their money beyond sharing this one counterparty placement.
          </p>
        )}
      </Card>
    </div>
  );
}

function RecordProceedsForm({
  placementId,
  investments,
  onRecorded,
}: {
  placementId: string;
  investments: InvestmentPlacementDetail["investments"];
  onRecorded: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = investments.reduce((sum, i) => sum + Number(i.allocatedAmount), 0);
  const parsedAmount = Number(amount);
  const preview =
    amount.trim().length > 0 && Number.isFinite(parsedAmount) && total > 0
      ? investments.map((i) => ({
          waqfName: i.waqf.name,
          share: (parsedAmount * Number(i.allocatedAmount)) / total,
        }))
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/investment-placements/${placementId}/proceeds`, {
        method: "POST",
        body: JSON.stringify({ amount, currency, description }),
      });
      onRecorded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-5 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && (
        <Alert tone="danger" title="Couldn't record proceeds">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Amount</label>
          <Input type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="w-28 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Currency</label>
          <Input required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Description</label>
          <Input required value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Recording…" : "Record"}
        </Button>
      </div>

      {preview && (
        <div className="rounded-md border border-dashed border-slate-300 bg-white p-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
            Estimated split across {preview.length} fund{preview.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-0.5 text-xs text-slate-600">
            {preview.map((p) => (
              <li key={p.waqfName}>
                {p.waqfName}: {formatAmount(p.share.toFixed(2))} {currency}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Estimate only — the actual amounts recorded may differ by a cent due to rounding.
          </p>
        </div>
      )}
    </form>
  );
}
