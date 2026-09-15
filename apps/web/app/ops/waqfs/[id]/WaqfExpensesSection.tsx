"use client";

// Itemized project costs (2026-09-15) — Founder/Waqf-side counterpart
// to VaultExpensesSection. Plain staff CRUD; each entry auto-posts a
// balanced journal entry (see WaqfLedgerSection below). No
// additionalCurrencies picker — unlike Vault, a Waqf Fund has one
// declared corpusCurrency (WaqfExpensesService.create() rejects any
// other, except for a legacy waqf with none declared at all, which
// falls through unchecked — see that method's own comment).
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount } from "../../../../lib/format";
import type { WaqfExpense, WaqfLedgerAccount, WaqfMilestone } from "../../../../lib/ops-types";
import { Alert, Button, EmptyState, Input, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

export function WaqfExpensesSection({
  waqfId,
  currency,
  milestones,
  onChanged,
}: {
  waqfId: string;
  currency: string;
  milestones: WaqfMilestone[];
  // Recording an expense against a milestone changes that milestone's
  // own actualSpend figure — this lets the parent page refetch
  // WaqfMilestonesSection's data too, so "Budget vs. actual" doesn't
  // sit stale until the next full page load.
  onChanged?: () => void;
}) {
  const {
    data: expenses,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<WaqfExpense[]>(`/waqf-expenses?waqfId=${waqfId}`), [waqfId]);
  const [expenseAccounts, setExpenseAccounts] = useState<WaqfLedgerAccount[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiFetchJson<WaqfLedgerAccount[]>("/waqf-ledger-accounts")
      .then((accounts) => setExpenseAccounts(accounts.filter((a) => a.type === "expense")))
      .catch(() => setExpenseAccounts([]));
  }, []);

  const milestoneName = (id: string | null) => milestones.find((m) => m.id === id)?.name ?? "—";

  return (
    <section>
      <SectionHeader
        title="Expenses"
        description="Itemized project spend — each one posts a balanced entry to this waqf's ledger below."
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
            Add an expense account on the Waqf Ledger Accounts page first.
          </Alert>
        ) : (
          <ExpenseForm
            waqfId={waqfId}
            currency={currency}
            expenseAccounts={expenseAccounts}
            milestones={milestones}
            onCreated={() => {
              setShowForm(false);
              load();
              onChanged?.();
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
                <TableCell className="text-slate-500">{milestoneName(e.waqfMilestoneId)}</TableCell>
                <TableCell className="tabular-nums text-slate-500">
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
  waqfId,
  currency,
  expenseAccounts,
  milestones,
  onCreated,
}: {
  waqfId: string;
  currency: string;
  expenseAccounts: WaqfLedgerAccount[];
  milestones: WaqfMilestone[];
  onCreated: () => void;
}) {
  const [ledgerAccountId, setLedgerAccountId] = useState(expenseAccounts[0]?.id ?? "");
  const [waqfMilestoneId, setWaqfMilestoneId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/waqf-expenses", {
        method: "POST",
        body: JSON.stringify({
          waqfId,
          waqfMilestoneId: waqfMilestoneId || undefined,
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
          <Select value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)}>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        {milestones.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Milestone (optional)</label>
            <Select value={waqfMilestoneId} onChange={(e) => setWaqfMilestoneId(e.target.value)}>
              <option value="">None</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
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
