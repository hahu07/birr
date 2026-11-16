"use client";

// Vault — a separate, staff-curated public-giving product, not part of
// the Founder/Waqf system at all (see packages/db/prisma/schema.prisma's
// own Vault section comment). Any authenticated staff member can create
// one and add causes here; the four money-moving decisions (cause/
// proceeds allocation, investment changes, distribution approval) are
// governed and reviewed on the existing Approvals page — that page
// already renders any permission generically, so no separate approval
// UI was needed for these.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../lib/api";
import { humanize, humanizeRoles } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { Vault, VaultType } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  IconArchive,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";
import { CountrySelect } from "../../../components/forms/CountrySelect";
import { countryName } from "@birr/shared";

const VAULT_TYPES: VaultType[] = ["project", "investment"];

const STATUS_TONE: Record<Vault["status"], "success" | "warning" | "neutral" | "danger"> = {
  draft: "neutral",
  open: "success",
  closed: "warning",
  archived: "danger",
};

export default function VaultsPage() {
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { can } = useStaffSession();
  // Hides controls the backend would 403 — creating a vault is mutawalli_officer-only.
  const canCreate = can("vault.curate");

  const load = useCallback(() => {
    apiFetchJson<Vault[]>("/vaults")
      .then(setVaults)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
          <IconArchive className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vaults</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Staff-curated public campaigns — anyone can donate, no Founder or Foundation involved. Separate from
            the Waqf Funds above.
          </p>
        </div>
      </header>

      <section>
        <SectionHeader
          title="Vaults"
          description="Starts as draft — add causes, then publish to make it visible on the public donation page."
          actionLabel={canCreate ? (showForm ? "Cancel" : "Create vault") : undefined}
          onAction={canCreate ? () => setShowForm((v) => !v) : undefined}
        />

        {canCreate && showForm && (
          <CreateForm
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        )}

        {error && (
          <Alert tone="danger" title="Couldn't load vaults" className="mb-4">
            {error}
          </Alert>
        )}

        {!error && vaults === null && <RowsSkeleton columns={5} />}

        {!error && vaults !== null && vaults.length === 0 && !showForm && (
          <EmptyState title="No vaults yet" description="Create one above to start a public giving campaign." />
        )}

        {!error && vaults !== null && vaults.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell />
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Currency</TableHeaderCell>
                <TableHeaderCell>Jurisdiction</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {vaults.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <Link href={`/ops/vaults/${v.id}`} className="block h-9 w-9 overflow-hidden rounded-lg bg-slate-100">
                      {v.coverImageUrl ? (
                        <img src={v.coverImageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-slate-400">
                          <IconArchive className="h-4 w-4" />
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    <Link href={`/ops/vaults/${v.id}`} className="hover:text-primary-700">
                      {v.name}
                    </Link>
                  </TableCell>
                  <TableCell>{humanize(v.type)}</TableCell>
                  <TableCell className="text-slate-500">
                    {v.currency}
                    {v.additionalCurrencies.length > 0 && (
                      <span className="text-slate-400"> + {v.additionalCurrencies.join(", ")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-500">{countryName(v.jurisdiction)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[v.status]}>{humanize(v.status)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <CurrencySettingCard setting={GIFT_MINIMUMS} />
        <CurrencySettingCard setting={DONOR_THRESHOLDS} />
      </section>
    </div>
  );
}

// Two per-currency Vault giving settings, one card shape:
//
// - Donor identity thresholds: the AML anti-structuring control (see
//   VaultContributionsService.findOrCreateDonor). Staff-only to view;
//   only compliance_officer can change it.
// - Minimum gift (2026-11-16): the smallest public gift, one-off or
//   monthly. Vault's own, so it never moves with the Waqf top-up floor in
//   Ops → Waqf Funding. Shown on the public giving page.
//
// Editing is enforced server-side regardless of what this page hides.
interface CurrencyAmount {
  id: string;
  currency: string;
  amount: string;
}

interface CurrencySetting {
  title: string;
  description: string;
  endpoint: string;
  /** The amount's field name in the API. */
  field: "thresholdAmount" | "minAmount";
  permission: string;
  amountLabel: string;
  emptyText: string;
  whoCanChange: string;
}

const DONOR_THRESHOLDS: CurrencySetting = {
  title: "Donor identity thresholds",
  description:
    "Per-currency AML control — a single contribution at or above this, or a donor's running total crossing it, requires their full name and an ID on the public donation form.",
  endpoint: "/vault-donor-thresholds",
  field: "thresholdAmount",
  permission: "vault.donor_threshold_set",
  amountLabel: "Threshold amount",
  emptyText: "No currency has an identity-capture threshold configured yet.",
  whoCanChange: "a compliance officer",
};

const GIFT_MINIMUMS: CurrencySetting = {
  title: "Minimum gift",
  description:
    "The smallest gift a donor can give to any Vault, one-off or monthly, shown on the public giving page. Separate from the Waqf top-up minimum.",
  endpoint: "/vault-gift-minimums",
  field: "minAmount",
  permission: "vault.gift_minimum_set",
  amountLabel: "Minimum amount",
  emptyText: "No currency has a minimum gift configured yet, so no gift can be taken in it.",
  whoCanChange: "a Mutawalli Officer",
};

function CurrencySettingCard({ setting }: { setting: CurrencySetting }) {
  const { staff, can } = useStaffSession();
  const [rows, setRows] = useState<CurrencyAmount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCurrency, setNewCurrency] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canEdit = can(setting.permission);
  const toRow = useCallback(
    (raw: Record<string, string>): CurrencyAmount => ({ id: raw.id, currency: raw.currency, amount: raw[setting.field] }),
    [setting.field],
  );

  useEffect(() => {
    apiFetchJson<Record<string, string>[]>(setting.endpoint)
      .then((data) => setRows(data.map(toRow)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [setting.endpoint, toRow]);

  async function save(currency: string, amount: string): Promise<CurrencyAmount> {
    const updated = await apiFetchJson<Record<string, string>>(`${setting.endpoint}/${currency}`, {
      method: "PUT",
      body: JSON.stringify({ [setting.field]: amount }),
    });
    return toRow(updated);
  }

  function upsertRow(row: CurrencyAmount) {
    setRows((prev) => {
      const list = prev ?? [];
      return list.some((r) => r.currency === row.currency)
        ? list.map((r) => (r.currency === row.currency ? row : r))
        : [...list, row].sort((a, b) => a.currency.localeCompare(b.currency));
    });
  }

  async function handleAdd() {
    if (!newCurrency.trim() || !newAmount.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      upsertRow(await save(newCurrency.trim().toUpperCase(), newAmount));
      setNewCurrency("");
      setNewAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <p className="mb-1 text-base font-semibold text-slate-900">{setting.title}</p>
      <p className="mb-4 text-sm text-slate-500">{setting.description}</p>

      {error && (
        <Alert tone="danger" title="Couldn't load or save" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && rows === null && <RowsSkeleton columns={2} />}

      {!error && rows !== null && rows.length === 0 && <EmptyState title="Nothing set" description={setting.emptyText} />}

      {!error && rows !== null && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <CurrencyAmountRow key={row.currency} row={row} canEdit={canEdit} onSave={(amount) => save(row.currency, amount)} onChanged={upsertRow} />
          ))}
        </div>
      )}

      {canEdit && (
        <div className="mt-5 flex items-end gap-2 border-t border-slate-100 pt-5">
          <div className="w-28">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Currency</label>
            <Input value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} placeholder="e.g. NGN" />
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">{setting.amountLabel}</label>
            <Input type="number" min="0" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="0.00" />
          </div>
          <Button type="button" onClick={handleAdd} disabled={submitting || !newCurrency.trim() || !newAmount.trim()}>
            {submitting ? "Saving…" : "Add"}
          </Button>
        </div>
      )}

      {!canEdit && staff && (
        <p className="mt-4 text-xs text-slate-500">
          Your role{staff.roles.length > 1 ? "s" : ""} ({humanizeRoles(staff.roles)}) can view these but not change them — reach out to{" "}
          {setting.whoCanChange}.
        </p>
      )}
    </Card>
  );
}

function CurrencyAmountRow({
  row,
  canEdit,
  onSave,
  onChanged,
}: {
  row: CurrencyAmount;
  canEdit: boolean;
  onSave: (amount: string) => Promise<CurrencyAmount>;
  onChanged: (next: CurrencyAmount) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.amount);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!value.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      onChanged(await onSave(value));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {error && (
        <Alert tone="danger" title="Couldn't save" className="mb-2">
          {error}
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 font-mono text-sm text-slate-700">{row.currency}</span>
        {editing ? (
          <>
            <Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} className="flex-1" aria-label={`${row.currency} amount`} />
            <Button type="button" onClick={handleSave} disabled={submitting || !value.trim()}>
              {submitting ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500">{row.amount}</span>
            {canEdit && (
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                Change
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<VaultType>("project");
  // Naira only (owner's decision, 2026-11-15): Paystack in NGN is the one
  // rail a Vault can receive through. The backend still supports other and
  // additional currencies, for when another rail works.
  const currency = "NGN";
  const [jurisdiction, setJurisdiction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/vaults", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug,
          description: description || undefined,
          type,
          currency,
          jurisdiction,
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
        <Alert tone="danger" title="Couldn't create vault">
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ramadan Relief" />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Slug (public URL)</label>
          <Input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="ramadan-relief-2026"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Description (optional)</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Type</label>
          <Select value={type} onChange={(e) => setType(e.target.value as VaultType)}>
            {VAULT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-28 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Currency</label>
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">NGN (₦)</p>
        </div>
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Jurisdiction</label>
          <CountrySelect value={jurisdiction} onChange={setJurisdiction} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
}
