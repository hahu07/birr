"use client";

// Who's staffed on this waqf, and in what governance function — CLAUDE.md's
// caseload concept (waqf_case_assignments). Not a governed_actions
// permission (see the backend controller's own comment: "No permission
// is seeded for 'who may assign caseloads.'") — any authenticated staff
// member can assign/close, plain CRUD, no maker-checker gate, no
// ProposeGovernedActionButton here. This is the write-side counterpart
// to My Desk (app/ops/page.tsx), which reads a signed-in staff member's
// own assignments but has never had anywhere to create one.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, humanize } from "../../../../lib/format";
import type { BirrStaff, WaqfCaseAssignment } from "../../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader, useLoadedResource } from "../../_components/SectionChrome";

const ASSIGNMENT_ROLES: WaqfCaseAssignment["assignmentRole"][] = [
  "mutawalli_officer",
  "investment_officer",
  "compliance_reviewer",
  "shariah_reviewer",
  "auditor",
];

const STATUS_TONE: Record<WaqfCaseAssignment["status"], "success" | "warning" | "neutral"> = {
  active: "success",
  reassigned: "warning",
  closed: "neutral",
};

export function CaseAssignmentsSection({ waqfId }: { waqfId: string }) {
  const {
    data: assignments,
    error,
    reload: load,
  } = useLoadedResource(() => apiFetchJson<WaqfCaseAssignment[]>(`/waqf-case-assignments?waqfId=${waqfId}`), [waqfId]);
  const [staff, setStaff] = useState<BirrStaff[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiFetchJson<BirrStaff[]>("/birr-staff")
      .then(setStaff)
      .catch(() => setStaff([]));
  }, []);

  // A suspended staff member shouldn't be offered in the picker, even
  // though the backend itself doesn't block assigning one.
  const activeStaff = staff.filter((s) => s.status === "active");

  return (
    <section>
      <SectionHeader
        title="Caseload"
        description="Which Birr staff serve which governance function on this fund."
        actionLabel={showForm ? "Cancel" : "Assign staff"}
        onAction={() => setShowForm((v) => !v)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load the caseload" className="mb-4">
          {error}
        </Alert>
      )}

      {showForm &&
        (activeStaff.length === 0 ? (
          <Alert tone="warning" title="No active staff to assign" className="mb-4">
            No active Birr staff accounts exist yet.
          </Alert>
        ) : (
          <AssignForm
            waqfId={waqfId}
            staff={activeStaff}
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        ))}

      {!error && assignments === null && <RowsSkeleton columns={5} />}

      {!error && assignments !== null && assignments.length === 0 && !showForm && (
        <EmptyState
          title="No one assigned yet"
          description="Assign a staff member above to give them this waqf on their own My Desk."
        />
      )}

      {!error && assignments !== null && assignments.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Staff</TableHeaderCell>
              <TableHeaderCell>Assignment role</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Assigned</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {assignments.map((a) => {
              const member = staff.find((s) => s.id === a.birrStaffId);
              return (
                <TableRow key={a.id}>
                  <TableCell className="font-medium text-slate-900">
                    {member?.user.fullName ?? "—"}
                    {member && <p className="text-xs font-normal text-slate-500">{member.user.email}</p>}
                  </TableCell>
                  <TableCell className="text-slate-500">{humanize(a.assignmentRole)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[a.status]}>{humanize(a.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-500">{formatDate(a.assignedAt)}</TableCell>
                  <TableCell>{a.status === "active" && <CloseAssignmentAction assignment={a} onClosed={load} />}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function AssignForm({
  waqfId,
  staff,
  onCreated,
}: {
  waqfId: string;
  staff: BirrStaff[];
  onCreated: () => void;
}) {
  const [birrStaffId, setBirrStaffId] = useState(staff[0]?.id ?? "");
  const [assignmentRole, setAssignmentRole] = useState<WaqfCaseAssignment["assignmentRole"]>("mutawalli_officer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/waqf-case-assignments", {
        method: "POST",
        body: JSON.stringify({ waqfId, birrStaffId, assignmentRole }),
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
        <Alert tone="danger" title="Couldn't assign staff">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Staff member</label>
          <select
            value={birrStaffId}
            onChange={(e) => setBirrStaffId(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.user.fullName} ({humanize(s.staffRole)})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Assignment role</label>
          <select
            value={assignmentRole}
            onChange={(e) => setAssignmentRole(e.target.value as WaqfCaseAssignment["assignmentRole"])}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {ASSIGNMENT_ROLES.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Assigning…" : "Assign"}
        </Button>
      </div>
    </form>
  );
}

// No confirmation dialog — matches this codebase's existing posture for
// reversible-in-effect, audit-logged staff actions (e.g.
// StatusChangeAction elsewhere in this directory). Two distinct
// outcomes on the same active row: "Close" (done, nothing further) vs
// "Reassign" (this specific case is moving to someone else) — both call
// the same endpoint with a different status.
function CloseAssignmentAction({ assignment, onClosed }: { assignment: WaqfCaseAssignment; onClosed: () => void }) {
  const [submitting, setSubmitting] = useState<"closed" | "reassigned" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function close(status: "closed" | "reassigned") {
    setError(null);
    setSubmitting(status);
    try {
      await apiFetchJson(`/waqf-case-assignments/${assignment.id}/close`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      onClosed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-xs font-medium text-primary-700 hover:underline disabled:opacity-60"
          disabled={submitting !== null}
          onClick={() => close("closed")}
        >
          {submitting === "closed" ? "Closing…" : "Close"}
        </button>
        <button
          type="button"
          className="text-xs font-medium text-primary-700 hover:underline disabled:opacity-60"
          disabled={submitting !== null}
          onClick={() => close("reassigned")}
        >
          {submitting === "reassigned" ? "Reassigning…" : "Reassign"}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
