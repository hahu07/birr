"use client";

// Project-vault lifecycle tracking (2026-09-13) — milestone creation is
// plain CRUD; marking one "completed" is always the governed
// vault.milestone_complete action, proposed here, decided on the
// Approval Queue page (never here) — same posture
// VaultDistributionsSection already established for
// vault.distribution_approve.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { humanize } from "../../../../lib/format";
import type { VaultMilestone } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";

const STATUS_TONE: Record<VaultMilestone["status"], "neutral" | "warning" | "success"> = {
  pending: "neutral",
  in_progress: "warning",
  completed: "success",
};

export function VaultMilestonesSection({ vaultId, onChanged }: { vaultId: string; onChanged: () => void }) {
  const {
    data: milestones,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<VaultMilestone[]>(`/vault-milestones?vaultId=${vaultId}`), [vaultId]);
  const [showForm, setShowForm] = useState(false);

  function reload() {
    load();
    onChanged();
  }

  return (
    <section>
      <SectionHeader
        title="Milestones"
        description="A project's real-world progress — a distribution can be that milestone's tranche only once it's marked completed, a maker-checker decision on the Approval Queue."
        actionLabel={showForm ? "Cancel" : "Add milestone"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load milestones" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm && (
        <MilestoneForm
          vaultId={vaultId}
          nextSequence={(milestones?.length ?? 0) + 1}
          onCreated={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      {!error && milestones === null && <RowsSkeleton columns={4} />}

      {!error && milestones !== null && milestones.length === 0 && !showForm && (
        <EmptyState title="No milestones yet" description="Add the first one above to start tracking this project's progress." />
      )}

      {!error && milestones !== null && milestones.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>#</TableHeaderCell>
              <TableHeaderCell>Milestone</TableHeaderCell>
              <TableHeaderCell>Target</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {milestones.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-slate-500">{m.sequence}</TableCell>
                <TableCell className="font-medium text-slate-900">
                  {m.name}
                  {m.description && <p className="mt-0.5 text-xs font-normal text-slate-500">{m.description}</p>}
                </TableCell>
                <TableCell className="text-slate-500">{m.targetAmount ?? "—"}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[m.status]}>{humanize(m.status)}</Badge>
                </TableCell>
                <TableCell>
                  {m.status !== "completed" && (
                    <ProposeGovernedActionButton
                      permissionKey="vault.milestone_complete"
                      payload={{ vaultMilestoneId: m.id }}
                      label="Propose completion"
                      onProposed={reload}
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

function MilestoneForm({ vaultId, nextSequence, onCreated }: { vaultId: string; nextSequence: number; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sequence, setSequence] = useState(String(nextSequence));
  const [targetAmount, setTargetAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/vault-milestones", {
        method: "POST",
        body: JSON.stringify({
          vaultId,
          name,
          description: description || undefined,
          sequence: Number(sequence),
          targetAmount: targetAmount || undefined,
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
        <Alert tone="danger" title="Couldn't add milestone">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Foundation laid" />
        </div>
        <div className="w-20 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Order</label>
          <Input type="number" min="1" required value={sequence} onChange={(e) => setSequence(e.target.value)} />
        </div>
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Target amount</label>
          <Input type="number" min="0" step="0.01" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
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
    </form>
  );
}
