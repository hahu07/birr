"use client";

// Itemized project costs (2026-09-13) — plain staff CRUD, same trust
// tier as VaultDistributionsSection's own registration form. Each entry
// auto-posts a balanced journal entry (see VaultLedgerSection below).
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount } from "../../../../lib/format";
import type { VaultExpense, VaultLedgerAccount, VaultMilestone } from "../../../../lib/ops-types";
import { Alert, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

export function VaultExpensesSection({
  vaultId,
  currency,
  milestones,
}: {
  vaultId: string;
  currency: string;
  milestones: VaultMilestone[];
}) {
  const {
    data: expenses,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<VaultExpense[]>(`/vault-expenses?vaultId=${vaultId}`), [vaultId]);
  const [expenseAccounts, setExpenseAccounts] = useState<VaultLedgerAccount[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiFetchJson<VaultLedgerAccount[]>("/vault-ledger-accounts")
      .then((accounts) => setExpenseAccounts(accounts.filter((a) => a.type === "expense")))
      .catch(() => setExpenseAccounts([]));
  }, []);

  const milestoneName = (id: string | null) => milestones.find((m) => m.id === id)?.name ?? "—";

  return (
    <section>
      <SectionHeader
        title="Expenses"
        description="Itemized project spend — each one posts a balanced entry to this vault's ledger below."
        actionLabel={showForm ? "Cancel" : "Add expense"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load expenses" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm &&
        (expenseAccounts.length === 0 ? (
          <Alert tone="warning" title="No expense accounts yet" className="mb-4">
            Add an expense account on the Vault Ledger Accounts page first.
          </Alert>
        ) : (
          <ExpenseForm
            vaultId={vaultId}
            currency={currency}
            expenseAccounts={expenseAccounts}
            milestones={milestones}
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        ))}

      {!error && expenses === null && <RowsSkeleton columns={4} />}

      {!error && expenses !== null && expenses.length === 0 && !showForm && (
        <EmptyState title="No expenses recorded yet" description="Add one above to itemize this project's spend." />
      )}

      {!error && expenses !== null && expenses.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Description</TableHeaderCell>
              <TableHeaderCell>Milestone</TableHeaderCell>
              <TableHeaderCell>Amount</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {expenses.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium text-slate-900">{e.description}</TableCell>
                <TableCell className="text-slate-500">{milestoneName(e.vaultMilestoneId)}</TableCell>
                <TableCell className="text-slate-500">
                  {formatAmount(e.amount)} {e.currency}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function ExpenseForm({
  vaultId,
  currency,
  expenseAccounts,
  milestones,
  onCreated,
}: {
  vaultId: string;
  currency: string;
  expenseAccounts: VaultLedgerAccount[];
  milestones: VaultMilestone[];
  onCreated: () => void;
}) {
  const [ledgerAccountId, setLedgerAccountId] = useState(expenseAccounts[0]?.id ?? "");
  const [vaultMilestoneId, setVaultMilestoneId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/vault-expenses", {
        method: "POST",
        body: JSON.stringify({
          vaultId,
          vaultMilestoneId: vaultMilestoneId || undefined,
          ledgerAccountId,
          amount,
          currency,
          description,
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
        <Alert tone="danger" title="Couldn't add expense">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Description</label>
          <Input required autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Cement — 50 bags" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Account</label>
          <select
            value={ledgerAccountId}
            onChange={(e) => setLedgerAccountId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {milestones.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Milestone (optional)</label>
            <select
              value={vaultMilestoneId}
              onChange={(e) => setVaultMilestoneId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">None</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
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
