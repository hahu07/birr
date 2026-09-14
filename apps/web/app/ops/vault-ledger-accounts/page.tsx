"use client";

// Vault's chart of accounts (2026-09-13) — a shared catalog across
// every vault, not per-vault, same "one standard list, staff-managed"
// convention as /ops/cause-categories. Writes are platform_admin-only
// (backend-enforced; this page also hides the form for other roles).
// The four isSystemDefault rows are what VaultLedgerService's three
// auto-posting hooks write to directly — retire() on the backend
// refuses to touch those, and this page's own Retire button is hidden
// for them so that refusal isn't discovered only after clicking.
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { VaultLedgerAccount } from "../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../_components/SectionChrome";

const ACCOUNT_TYPES: VaultLedgerAccount["type"][] = ["asset", "liability", "equity", "revenue", "expense"];

export default function VaultLedgerAccountsPage() {
  const { staff } = useStaffSession();
  const isAdmin = staff?.staffRole === "platform_admin";

  const { data: accounts, error, reload: load } = useLoadedResource(() => apiFetchJson<VaultLedgerAccount[]>("/vault-ledger-accounts"), []);
  const [showForm, setShowForm] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);

  async function handleRetire(account: VaultLedgerAccount) {
    setPendingId(account.id);
    setRetireError(null);
    try {
      await apiFetchJson(`/vault-ledger-accounts/${account.id}/retire`, { method: "POST" });
      load();
    } catch (err) {
      setRetireError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vault Ledger Accounts</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Vault's chart of accounts — every confirmed contribution, paid distribution, and recorded expense posts
          to these.
        </p>
      </header>

      {!isAdmin && staff && (
        <Alert tone="danger" title="platform_admin only to edit" className="mb-6">
          Your role ({humanize(staff.staffRole)}) can view this page but not change it — reach out to a platform
          admin.
        </Alert>
      )}

      <section>
        <SectionHeader
          title="Accounts"
          description="Retiring an account only affects new activity — it stays visible on any journal entry already posted to it."
          actionLabel={isAdmin ? (showForm ? "Cancel" : "Add account") : undefined}
          onAction={isAdmin ? () => setShowForm((v) => !v) : undefined}
        />

        {isAdmin && showForm && (
          <AccountForm
            onSaved={() => {
              setShowForm(false);
              load();
            }}
          />
        )}

        {error && (
          <Alert tone="danger" title="Couldn't load accounts" className="mb-4">
            {error}
          </Alert>
        )}

        {retireError && (
          <Alert tone="danger" title="Couldn't retire account" className="mb-4">
            {retireError}
          </Alert>
        )}

        {!error && accounts === null && <RowsSkeleton columns={4} />}

        {!error && accounts !== null && accounts.length === 0 && (
          <EmptyState title="No accounts yet" description="Add one above — or run the seed script for the four defaults." />
        )}

        {!error && accounts !== null && accounts.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                {isAdmin && <TableHeaderCell className="text-right">Actions</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono tabular-nums text-slate-500">{a.code}</TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {a.name}
                    {a.isSystemDefault && (
                      <Badge tone="neutral" className="ml-2">
                        System
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-500">{humanize(a.type)}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      {!a.isSystemDefault && (
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          disabled={pendingId === a.id}
                          onClick={() => handleRetire(a)}
                        >
                          {pendingId === a.id ? "…" : "Retire"}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function AccountForm({ onSaved }: { onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<VaultLedgerAccount["type"]>("expense");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/vault-ledger-accounts", { method: "POST", body: JSON.stringify({ code, name, type }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't add account">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Code</label>
          <Input required autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="5100" />
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Materials" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Type</label>
          <Select value={type} onChange={(e) => setType(e.target.value as VaultLedgerAccount["type"])}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}
