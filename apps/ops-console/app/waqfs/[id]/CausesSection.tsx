"use client";

// Causes are the theme/purpose buckets within one Waqf Fund (e.g. an
// "Education Fund" waqf might have "Scholarships" and "School Supplies"
// causes) — Beneficiaries and Distributions both reference one, so this
// section sits first and hands its list up to the page via onChanged.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import type { WaqfCause } from "../../../lib/types";
import { Alert, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../../_components/SectionChrome";

export function CausesSection({ waqfId, onChanged }: { waqfId: string; onChanged: () => void }) {
  const [causes, setCauses] = useState<WaqfCause[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`)
      .then(setCauses)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

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

      {!error && causes === null && <RowsSkeleton columns={2} />}

      {!error && causes !== null && causes.length === 0 && !showForm && (
        <EmptyState title="No causes yet" description="Add one above to start tracking beneficiaries against it." />
      )}

      {!error && causes !== null && causes.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Description</TableHeaderCell>
              <TableHeaderCell className="text-right">Added</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {causes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-slate-900">{c.name}</TableCell>
                <TableCell className="text-slate-500">{c.description ?? "—"}</TableCell>
                <TableCell className="text-right text-slate-500">{formatDate(c.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
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
