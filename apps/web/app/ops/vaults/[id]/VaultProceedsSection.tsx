"use client";

// Investment-style vaults only — mirrors the Waqf side's ProceedsSection.
// Recording here is plain staff CRUD; VaultProceedsService deliberately
// does NOT auto-reallocate proceeds across causes on every record() (see
// that service's own comment) — staff set each cause's proceeds
// allocation explicitly via the governed vault.proceeds_allocate action
// in VaultCausesSection above.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate } from "../../../../lib/format";
import type { VaultInvestment, VaultProceeds } from "../../../../lib/ops-types";
import { Alert, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

export function VaultProceedsSection({ vaultId, currency }: { vaultId: string; currency: string }) {
  const {
    data: proceeds,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<VaultProceeds[]>(`/vault-proceeds?vaultId=${vaultId}`), [vaultId]);
  const [investments, setInvestments] = useState<VaultInvestment[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiFetchJson<VaultInvestment[]>(`/vault-investments?vaultId=${vaultId}`).then(setInvestments).catch(() => setInvestments([]));
  }, [vaultId]);

  const total = (proceeds ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <section>
      <SectionHeader
        title="Proceeds"
        description="Investment returns recorded over time. Allocate to a cause above via a governed approval — recording here doesn't do it automatically."
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
          vaultId={vaultId}
          currency={currency}
          investments={investments}
          onCreated={() => {
            setShowForm(false);
            load();
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
                    {investments.find((i) => i.id === p.vaultInvestmentId)?.name ?? "—"}
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
  vaultId,
  currency,
  investments,
  onCreated,
}: {
  vaultId: string;
  currency: string;
  investments: VaultInvestment[];
  onCreated: () => void;
}) {
  const [vaultInvestmentId, setVaultInvestmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/vault-proceeds", {
        method: "POST",
        body: JSON.stringify({ vaultId, vaultInvestmentId: vaultInvestmentId || undefined, amount, currency, description }),
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
            value={vaultInvestmentId}
            onChange={(e) => setVaultInvestmentId(e.target.value)}
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
          <label className="text-sm font-medium text-slate-700">Amount ({currency})</label>
          <Input type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
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
