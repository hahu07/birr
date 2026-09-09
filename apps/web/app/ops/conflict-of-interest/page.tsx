"use client";

// Conflict-of-Interest Declarations — CLAUDE.md's non-negotiable:
// declarations required of Birr staff on waqf-specific or general
// governance matters, stored as structured data. Any active BirrStaff
// may declare their own conflict or review someone else's — never their
// own (checker_not_maker-style DB constraint: coi_reviewer_not_declarant).
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, humanize } from "../../../lib/format";
import { markNotificationsReadForEntity } from "../../../lib/notifications";
import { useStaffSession } from "../../../lib/staff-session";
import type { ConflictOfInterestDeclaration } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconClipboardCheck,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const STATUS_TONE: Record<ConflictOfInterestDeclaration["status"], "warning" | "success" | "neutral" | "danger"> = {
  declared: "warning",
  reviewed: "neutral",
  cleared: "success",
  escalated: "danger",
};

export default function ConflictOfInterestPage() {
  const { staff } = useStaffSession();
  const [declarations, setDeclarations] = useState<ConflictOfInterestDeclaration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    apiFetchJson<ConflictOfInterestDeclaration[]>("/conflict-of-interest-declarations")
      .then(setDeclarations)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — covers coi.needs_review,
  // coi.escalated, and coi.reviewed, all of which link here.
  useEffect(() => {
    declarations?.forEach((d) => markNotificationsReadForEntity("ConflictOfInterestDeclaration", d.id));
  }, [declarations]);

  const query = search.trim().toLowerCase();
  const visibleDeclarations =
    declarations?.filter(
      (d) =>
        !query ||
        d.birrStaff.user.fullName.toLowerCase().includes(query) ||
        (d.waqf?.name ?? "").toLowerCase().includes(query) ||
        d.declarationText.toLowerCase().includes(query),
    ) ?? [];

  return (
    <div>
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Conflicts of Interest</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Declarations on waqf-specific or general governance matters.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Declare a conflict"}</Button>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load declarations" className="mb-6">
          {error}
        </Alert>
      )}

      {showForm && (
        <DeclareForm
          onDeclared={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {!error && declarations === null && <DeclarationsSkeleton />}

      {!error && declarations !== null && declarations.length === 0 && !showForm && (
        <EmptyState title="No declarations yet" description="Declare one above when a conflict arises." />
      )}

      {!error && declarations !== null && declarations.length > 0 && (
        <>
          <Input
            placeholder="Search by staff member, waqf, or declaration text…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 max-w-sm"
          />
          {visibleDeclarations.length === 0 ? (
            <p className="text-sm text-slate-500">No declarations match "{search.trim()}".</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Staff member</TableHeaderCell>
                  <TableHeaderCell>Waqf</TableHeaderCell>
                  <TableHeaderCell>Declaration</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Declared</TableHeaderCell>
                  <TableHeaderCell className="text-right">Review</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleDeclarations.map((d) => (
                  <DeclarationRow key={d.id} declaration={d} currentUserId={staff?.userId} onChanged={load} />
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

function DeclarationRow({
  declaration,
  currentUserId,
  onChanged,
}: {
  declaration: ConflictOfInterestDeclaration;
  currentUserId: string | undefined;
  onChanged: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReview = declaration.status === "declared" && declaration.birrStaff.user.id !== currentUserId;

  async function review(status: "reviewed" | "cleared" | "escalated") {
    setError(null);
    setReviewing(true);
    try {
      await apiFetchJson(`/conflict-of-interest-declarations/${declaration.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setReviewing(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium text-slate-900">{declaration.birrStaff.user.fullName}</span>
        <p className="text-xs text-slate-500">{humanize(declaration.birrStaff.staffRole)}</p>
      </TableCell>
      <TableCell className="text-slate-500">{declaration.waqf?.name ?? "General"}</TableCell>
      <TableCell className="max-w-xs truncate text-slate-500" title={declaration.declarationText}>
        {declaration.declarationText}
      </TableCell>
      <TableCell>
        <Badge tone={STATUS_TONE[declaration.status]}>{humanize(declaration.status)}</Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-slate-500">{formatDate(declaration.declaredAt)}</TableCell>
      <TableCell className="text-right">
        {error && <span className="mr-2 text-xs text-red-600">{error}</span>}
        {canReview ? (
          <div className="inline-flex gap-1.5">
            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={reviewing} onClick={() => review("cleared")}>
              Clear
            </Button>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={reviewing} onClick={() => review("reviewed")}>
              Reviewed
            </Button>
            <Button variant="danger" className="px-2.5 py-1 text-xs" disabled={reviewing} onClick={() => review("escalated")}>
              Escalate
            </Button>
          </div>
        ) : declaration.reviewedByUser ? (
          <span className="text-xs text-slate-500">
            by {declaration.reviewedByUser.fullName}
            {declaration.reviewedAt && ` · ${formatDate(declaration.reviewedAt)}`}
          </span>
        ) : declaration.status === "declared" ? (
          <span className="text-xs text-slate-500">Awaiting a different reviewer</span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function DeclareForm({ onDeclared }: { onDeclared: () => void }) {
  const [waqfId, setWaqfId] = useState("");
  const [declarationText, setDeclarationText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/conflict-of-interest-declarations", {
        method: "POST",
        body: JSON.stringify({ declarationText, waqfId: waqfId.trim() || undefined }),
      });
      onDeclared();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't declare conflict">
          {error}
        </Alert>
      )}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Waqf ID (optional)</label>
        <Input
          value={waqfId}
          onChange={(e) => setWaqfId(e.target.value)}
          placeholder="Paste a Waqf Fund ID, or leave blank for a general declaration"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Declaration</label>
        <textarea
          required
          autoFocus
          rows={3}
          value={declarationText}
          onChange={(e) => setDeclarationText(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit declaration"}
      </Button>
    </form>
  );
}

function DeclarationsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-8 px-5 py-3.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
