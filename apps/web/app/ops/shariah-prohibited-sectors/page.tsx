"use client";

// The staff-curated catalog a shariah_board_member references when
// deciding an Investment/VaultInvestment's Shariah screening — shared
// between Waqf and Vault, same posture as Cause Categories. Writes are
// platform_admin-only (backend-enforced; this page also hides the form
// for other roles, same posture as the Jurisdictions/Platform Settings
// pages). Same shape as /ops/jurisdictions: read for everyone, add form
// for admins only, no edit/delete UI in this first slice.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, humanize } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { ShariahProhibitedSector } from "../../../lib/ops-types";
import { Alert, Button, EmptyState, IconShieldAlert, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";

export default function ShariahProhibitedSectorsPage() {
  const { staff } = useStaffSession();
  const isAdmin = staff?.staffRole === "platform_admin";

  const [sectors, setSectors] = useState<ShariahProhibitedSector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<ShariahProhibitedSector[]>("/shariah-prohibited-sectors")
      .then(setSectors)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconShieldAlert className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Shariah Prohibited Sectors</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            The catalog a shariah_board_member draws from when flagging a sector on an investment's Shariah
            screening — shared between Waqf and Vault investments.
          </p>
        </div>
      </header>

      {!isAdmin && staff && (
        <Alert tone="danger" title="platform_admin only to edit" className="mb-6">
          Your role ({humanize(staff.staffRole)}) can view this page but not change it — reach out to a platform
          admin.
        </Alert>
      )}

      <section>
        <SectionHeader
          title="Prohibited Sectors"
          description="A sector referenced from a screening's flaggedSectorIds — removing one leaves any past screening that flagged it unaffected, just no longer selectable for new ones."
          actionLabel={isAdmin ? (showForm ? "Cancel" : "Add sector") : undefined}
          onAction={isAdmin ? () => setShowForm((v) => !v) : undefined}
        />

        {isAdmin && showForm && (
          <SectorForm
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        )}

        {error && (
          <Alert tone="danger" title="Couldn't load prohibited sectors" className="mb-4">
            {error}
          </Alert>
        )}

        {!error && sectors === null && <RowsSkeleton columns={3} />}

        {!error && sectors !== null && sectors.length === 0 && (
          <EmptyState
            title="No prohibited sectors recorded yet"
            description="Add the classical exclusions (riba, alcohol, gambling, etc.) so the screening decision form has something to flag against."
          />
        )}

        {!error && sectors !== null && sectors.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
                <TableHeaderCell>Added</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sectors.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-slate-900">{s.name}</TableCell>
                  <TableCell className="max-w-md truncate text-slate-500" title={s.description ?? undefined}>
                    {s.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">{formatDate(s.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function SectorForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/shariah-prohibited-sectors", {
        method: "POST",
        body: JSON.stringify({ name, description: description || undefined }),
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
        <Alert tone="danger" title="Couldn't add sector">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus placeholder="e.g. Gambling" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-[16rem] flex-1 space-y-1.5">
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
