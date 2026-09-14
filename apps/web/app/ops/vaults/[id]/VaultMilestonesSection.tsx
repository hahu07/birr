"use client";

// Project-vault lifecycle tracking (2026-09-13) — milestone creation is
// plain CRUD; marking one "completed" is always the governed
// vault.milestone_complete action, proposed here, decided on the
// Approval Queue page (never here) — same posture
// VaultDistributionsSection already established for
// vault.distribution_approve.
import { Fragment, useRef, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, humanize } from "../../../../lib/format";
import type { VaultMilestone } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";
import { ProposeGovernedActionButton } from "../../_components/ProposeGovernedAction";

const STATUS_TONE: Record<VaultMilestone["status"], "neutral" | "warning" | "success"> = {
  pending: "neutral",
  in_progress: "warning",
  completed: "success",
};

export function VaultMilestonesSection({ vaultId, currency, onChanged }: { vaultId: string; currency: string; onChanged: () => void }) {
  const {
    data: milestones,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<VaultMilestone[]>(`/vault-milestones?vaultId=${vaultId}`), [vaultId]);
  const [showForm, setShowForm] = useState(false);
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);

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
              <TableHeaderCell>Budget vs. actual</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {milestones.map((m) => (
              <Fragment key={m.id}>
                <TableRow>
                  <TableCell className="text-slate-500">{m.sequence}</TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {m.name}
                    {m.description && (
                      <p className="mt-0.5 max-w-xs break-words text-xs font-normal text-slate-500">{m.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-slate-500">
                    <BudgetVsActual milestone={m} currency={currency} />
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[m.status]}>{humanize(m.status)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {m.status === "pending" && <StartButton milestoneId={m.id} onStarted={reload} />}
                      {m.status !== "completed" && (
                        <ProposeGovernedActionButton
                          permissionKey="vault.milestone_complete"
                          payload={{ vaultMilestoneId: m.id }}
                          label="Propose completion"
                          onProposed={reload}
                        />
                      )}
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => setExpandedEvidenceId((current) => (current === m.id ? null : m.id))}
                      >
                        {m.evidenceFileUrl || m.evidenceNotes ? "Evidence ✓" : "Add evidence"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedEvidenceId === m.id && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-slate-50">
                      <EvidencePanel milestone={m} onSaved={reload} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// Budget-vs-actual (2026-09-14) — targetAmount is always the vault's
// primary currency (see Vault.additionalCurrencies's own comment);
// actualSpend is per-currency (a milestone's expenses aren't
// currency-locked the same way), so the primary-currency entry is what
// gets compared against the target, and anything spent in another
// currency gets its own line rather than being folded in.
function BudgetVsActual({ milestone, currency }: { milestone: VaultMilestone; currency: string }) {
  const spent = Number(milestone.actualSpend.find((s) => s.currency === currency)?.amount ?? "0");
  const otherSpend = milestone.actualSpend.filter((s) => s.currency !== currency && Number(s.amount) > 0);
  const target = milestone.targetAmount ? Number(milestone.targetAmount) : null;

  if (target === null && spent === 0 && otherSpend.length === 0) return <>—</>;

  const overBudget = target !== null && spent > target;

  return (
    <div>
      {target !== null ? (
        <p className={overBudget ? "font-semibold text-red-600" : undefined}>
          {currency} {formatAmount(spent)} <span className="font-normal text-slate-400">of {formatAmount(target)}</span>
        </p>
      ) : spent > 0 ? (
        <p>
          {currency} {formatAmount(spent)} spent
        </p>
      ) : null}
      {otherSpend.length > 0 && (
        <p className="mt-0.5 text-xs text-slate-400">
          + {otherSpend.map((s) => `${s.currency} ${formatAmount(s.amount)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

// Plain staff action, not governed — marking work as started moves no
// money (see VaultMilestonesService.markInProgress's own comment), so
// this is a direct call, not a ProposeGovernedActionButton.
function StartButton({ milestoneId, onStarted }: { milestoneId: string; onStarted: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetchJson(`/vault-milestones/${milestoneId}/start`, { method: "POST" });
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={submitting} onClick={handleClick}>
        {submitting ? "…" : "Mark as started"}
      </Button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
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

// Milestone evidence (2026-09-14) — a photo or completion-report PDF,
// plus free-text notes, independent of vault.milestone_complete (see
// VaultMilestonesService.setEvidence's own comment on why this isn't a
// second governed checkpoint). Notes and file are saved separately —
// picking a file uploads it immediately, since a staff member expects
// "I chose a file" to mean "it's attached," not "attached once I also
// remember to click a separate Save."
function EvidencePanel({ milestone, onSaved }: { milestone: VaultMilestone; onSaved: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState(milestone.evidenceNotes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveNotes() {
    setSavingNotes(true);
    setError(null);
    try {
      await apiFetchJson(`/vault-milestones/${milestone.id}/evidence`, { method: "POST", body: JSON.stringify({ evidenceNotes: notes }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("evidence", file);
      await apiFetchJson(`/vault-milestones/${milestone.id}/evidence`, { method: "POST", body: formData });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploadingFile(false);
    }
  }

  return (
    <div className="space-y-3 py-2">
      {error && (
        <Alert tone="danger" title="Couldn't save evidence">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[16rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Drilled to 40m, water tested clean"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={savingNotes} onClick={handleSaveNotes}>
            {savingNotes ? "Saving…" : "Save notes"}
          </Button>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700">File</p>
          {milestone.evidenceFileUrl && (
            <a
              href={milestone.evidenceFileUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-sm text-primary-700 hover:underline"
            >
              View current file →
            </a>
          )}
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={handleFileSelected} />
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={uploadingFile}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadingFile ? "Uploading…" : milestone.evidenceFileUrl ? "Replace file" : "Upload file"}
          </Button>
          <p className="text-xs text-slate-400">PNG, JPEG, WebP, or PDF — 10MB max.</p>
        </div>
      </div>
    </div>
  );
}
