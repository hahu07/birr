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
import { humanize } from "../../../lib/format";
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

interface VaultDonorThreshold {
  id: string;
  currency: string;
  thresholdAmount: string;
}

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
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
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
          actionLabel={showForm ? "Cancel" : "Create vault"}
          onAction={() => setShowForm((v) => !v)}
        />

        {showForm && (
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
                  <TableCell className="text-slate-500">{v.jurisdiction}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[v.status]}>{humanize(v.status)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="mt-10">
        <VaultDonorThresholdsCard />
      </section>
    </div>
  );
}

// AML anti-structuring control — see VaultContributionsService
// .findOrCreateDonor's own comment: crossing this (a single
// contribution, or a donor's running total) requires identity capture
// on the public donation form. Staff-only to even view (unlike the
// Waqf side's corpus/contribution minimums, which are public-by-design
// informational floors — see /ops/waqf-funding and this endpoint's own
// controller comment for why this one isn't); only compliance_officer
// can change it, enforced server-side regardless of what this page hides.
function VaultDonorThresholdsCard() {
  const { staff } = useStaffSession();
  const [thresholds, setThresholds] = useState<VaultDonorThreshold[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCurrency, setNewCurrency] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canEdit = staff?.staffRole === "compliance_officer";

  useEffect(() => {
    apiFetchJson<VaultDonorThreshold[]>("/vault-donor-thresholds")
      .then(setThresholds)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  async function handleAdd() {
    if (!newCurrency.trim() || !newAmount.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const currency = newCurrency.trim().toUpperCase();
      const updated = await apiFetchJson<VaultDonorThreshold>(`/vault-donor-thresholds/${currency}`, {
        method: "PUT",
        body: JSON.stringify({ thresholdAmount: newAmount }),
      });
      setThresholds((prev) => {
        const list = prev ?? [];
        const existingIndex = list.findIndex((t) => t.currency === currency);
        return existingIndex >= 0
          ? list.map((t, i) => (i === existingIndex ? updated : t))
          : [...list, updated].sort((a, b) => a.currency.localeCompare(b.currency));
      });
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
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Donor identity thresholds</p>
      <p className="mb-4 text-sm text-slate-500">
        Per-currency AML control — a single contribution at or above this, or a donor's running total crossing it,
        requires their full name and an ID on the public donation form.
      </p>

      {error && (
        <Alert tone="danger" title="Couldn't load or save" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && thresholds === null && <RowsSkeleton columns={2} />}

      {!error && thresholds !== null && thresholds.length === 0 && (
        <EmptyState title="No thresholds set" description="No currency has an identity-capture threshold configured yet." />
      )}

      {!error && thresholds !== null && thresholds.length > 0 && (
        <div className="space-y-3">
          {thresholds.map((threshold) => (
            <ThresholdRow
              key={threshold.currency}
              threshold={threshold}
              canEdit={canEdit}
              onChanged={(next) =>
                setThresholds((prev) => (prev ?? []).map((t) => (t.currency === next.currency ? next : t)))
              }
            />
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
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Threshold amount</label>
            <Input type="number" min="0" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="0.00" />
          </div>
          <Button type="button" onClick={handleAdd} disabled={submitting || !newCurrency.trim() || !newAmount.trim()}>
            {submitting ? "Saving…" : "Add"}
          </Button>
        </div>
      )}

      {!canEdit && staff && (
        <p className="mt-4 text-xs text-slate-500">
          Your role ({staff.staffRole}) can view these but not change them — reach out to a compliance officer.
        </p>
      )}
    </Card>
  );
}

function ThresholdRow({
  threshold,
  canEdit,
  onChanged,
}: {
  threshold: VaultDonorThreshold;
  canEdit: boolean;
  onChanged: (next: VaultDonorThreshold) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(threshold.thresholdAmount);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!value.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetchJson<VaultDonorThreshold>(`/vault-donor-thresholds/${threshold.currency}`, {
        method: "PUT",
        body: JSON.stringify({ thresholdAmount: value }),
      });
      onChanged(updated);
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
        <span className="w-16 shrink-0 font-mono text-sm text-slate-700">{threshold.currency}</span>
        {editing ? (
          <>
            <Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} className="flex-1" />
            <Button type="button" onClick={handleSave} disabled={submitting || !value.trim()}>
              {submitting ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500">
              {threshold.thresholdAmount}
            </span>
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
  const [currency, setCurrency] = useState("USD");
  const [additionalCurrencies, setAdditionalCurrencies] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Comma-separated, same free-text convention as this form's own
      // Currency/Jurisdiction fields rather than a fancier multi-select
      // — the backend already dedupes against the primary currency and
      // against itself (VaultsService.create's own comment).
      const additional = additionalCurrencies
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
      await apiFetchJson("/vaults", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug,
          description: description || undefined,
          type,
          currency,
          additionalCurrencies: additional.length > 0 ? additional : undefined,
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
        <div className="w-24 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Currency</label>
          <Input required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Additional currencies (optional)</label>
          <Input
            value={additionalCurrencies}
            onChange={(e) => setAdditionalCurrencies(e.target.value)}
            placeholder="e.g. NGN, USDC"
          />
        </div>
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Jurisdiction</label>
          <Input required value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="NG" />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
}
