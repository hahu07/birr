"use client";

// Asset registration is plain CRUD (see schema.prisma's comment on
// Asset) — disposal is always a governed_actions asset.dispose action,
// decided on the Approval Queue page (never here). Propose control is
// the "Propose disposal" button per active-status row below.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, humanize } from "../../../../lib/format";
import type { Asset } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";

const CATEGORIES: Asset["category"][] = [
  "real_estate",
  "cash",
  "securities",
  "movable",
  "intellectual_property",
  "other",
];

export function AssetsSection({ waqfId }: { waqfId: string }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<Asset[]>(`/assets?waqfId=${waqfId}`)
      .then(setAssets)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [waqfId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <SectionHeader
        title="Assets"
        description="Registered assets held by this fund."
        actionLabel={showForm ? "Cancel" : "Add asset"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load assets" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm && (
        <AssetForm
          waqfId={waqfId}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {!error && assets === null && <RowsSkeleton columns={4} />}

      {!error && assets !== null && assets.length === 0 && !showForm && (
        <EmptyState title="No assets registered yet" description="Add one above to start tracking it." />
      )}

      {!error && assets !== null && assets.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Estimated value</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {assets.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium text-slate-900">{a.name}</TableCell>
                <TableCell>{humanize(a.category)}</TableCell>
                <TableCell className="text-slate-500">{a.currency} {formatAmount(a.estimatedValue)}</TableCell>
                <TableCell>
                  <Badge tone={a.status === "active" ? "success" : "neutral"}>{humanize(a.status)}</Badge>
                </TableCell>
                <TableCell>
                  {a.status === "active" && (
                    <ProposeGovernedActionButton
                      permissionKey="asset.dispose"
                      payload={{ assetId: a.id }}
                      label="Propose disposal"
                      onProposed={load}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function AssetForm({ waqfId, onCreated }: { waqfId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Asset["category"]>("real_estate");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/assets", {
        method: "POST",
        body: JSON.stringify({ waqfId, name, category, estimatedValue }),
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
        <Alert tone="danger" title="Couldn't add asset">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Asset["category"])}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Estimated value</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            value={estimatedValue}
            onChange={(e) => setEstimatedValue(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}
