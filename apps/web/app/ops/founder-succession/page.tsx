"use client";

// Primary contact succession (2026-11-15). Open requests to change who is
// a Founder's primary contact: the contact's own handover, or a report
// (from a member, or recorded here by a Mutawalli Officer for family or
// an institution) that the contact can't act. A Mutawalli Officer proposes
// the change (founder.primary_contact_change); Compliance or the Board
// approves it in Approvals. For a "can't act" case the outgoing contact is
// told at once and has 7 days to object first.
// Viewing: founder.succession_view. Recording / closing:
// founder.succession_record. Proposing: the governed permission's makers.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { Founder } from "../../../lib/ops-types";
import type { FounderMembership, PrimaryContactSuccession } from "../../../lib/types";
import { Alert, Badge, Button, Combobox, EmptyState, Select } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";

interface StaffSuccession extends PrimaryContactSuccession {
  founder: { id: string; name: string };
  recordedBy: { fullName: string } | null;
  pendingApproval: { id: string; proposedBy: string | null } | null;
}

const STATUS_TONE = { requested: "warning", approved: "info", objected: "danger", completed: "success", rejected: "neutral", cancelled: "neutral" } as const;
const STATUS_LABEL = {
  requested: "Requested",
  approved: "Approved, invitation sent",
  objected: "Objected",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Closed",
} as const;

const textareaClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

export default function FounderSuccessionPage() {
  const { staff, can } = useStaffSession();
  const [cases, setCases] = useState<StaffSuccession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<StaffSuccession[]>("/staff/founder-succession")
      .then(setCases)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);
  useEffect(load, [load]);

  if (staff && !can("founder.succession_view")) {
    return (
      <Alert tone="danger" title="Not available to your role">
        Primary contact changes are for Mutawalli Officers, Compliance, the Board of Trustees and the Audit Committee.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Primary Contact Changes"
        description="Requests to change who is a Founder's primary contact. A Mutawalli Officer proposes the change; Compliance or the Board approves it in Approvals. If the contact can't act, they're told first and have 7 days to object."
        actionLabel={can("founder.succession_record") && !recording ? "Record a request…" : undefined}
        onAction={() => setRecording(true)}
      />

      {error && (
        <Alert tone="danger" title="Couldn't load requests">
          {error}
        </Alert>
      )}

      {recording && (
        <RecordForm
          onCancel={() => setRecording(false)}
          onRecorded={() => {
            setRecording(false);
            load();
          }}
        />
      )}

      {!cases && !error && <RowsSkeleton columns={3} />}
      {cases && cases.length === 0 && <EmptyState title="No open requests" description="Every Founder's primary contact is settled." />}
      {cases && cases.length > 0 && (
        <ul className="space-y-4">
          {cases.map((c) => (
            <CaseCard key={c.id} succession={c} canPropose={can("founder.primary_contact_change")} canClose={can("founder.succession_record")} onChanged={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

function incoming(c: PrimaryContactSuccession) {
  return c.newMembership ? `${c.newMembership.user.fullName} (already a member)` : `${c.newFullName} · ${c.newEmail} (new to Birr; invited on approval)`;
}

function CaseCard({
  succession: c,
  canPropose,
  canClose,
  onChanged,
}: {
  succession: StaffSuccession;
  canPropose: boolean;
  canClose: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"propose" | "close" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "close": closing the case; "objection": recording an objection the
  // contact made by phone, email or letter.
  const [noteFor, setNoteFor] = useState<"close" | "objection" | null>(null);
  const [note, setNote] = useState("");
  const [loadedAt] = useState(() => Date.now());
  const noticeRunning = new Date(c.earliestApprovalAt).getTime() > loadedAt;

  async function propose() {
    setBusy("propose");
    setError(null);
    try {
      await apiFetchJson("/governed-actions", { method: "POST", body: JSON.stringify({ permissionKey: "founder.primary_contact_change", payload: { successionId: c.id } }) });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function submitNote() {
    setBusy("close");
    setError(null);
    try {
      await apiFetchJson(`/staff/founder-succession/${c.id}/${noteFor === "objection" ? "objection" : "close"}`, { method: "POST", body: JSON.stringify({ note: note.trim() }) });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {c.founder.name} · {c.kind === "handover" ? "Handover by the contact" : "Contact can't act"}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {c.outgoingMembership.user.fullName} → {incoming(c)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[c.status]}>{c.pendingApproval ? "Awaiting approval" : STATUS_LABEL[c.status]}</Badge>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-500">Reason</dt>
          <dd className="text-slate-800">{c.reason}</dd>
        </div>
        {c.evidenceNote && (
          <div>
            <dt className="text-xs font-medium text-slate-500">Evidence</dt>
            <dd className="text-slate-800">{c.evidenceNote}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium text-slate-500">Asked by</dt>
          <dd className="text-slate-800">
            {c.requestedBy ? `${c.requestedBy.fullName} (Founder member)` : c.recordedBy ? `Recorded by ${c.recordedBy.fullName}` : "—"} on {formatDate(c.createdAt)}
          </dd>
        </div>
        {c.kind === "unreachable" && (
          <div>
            <dt className="text-xs font-medium text-slate-500">Notice to the outgoing contact</dt>
            <dd className="text-slate-800">
              Told {formatDate(c.outgoingNotifiedAt ?? c.createdAt)}; can object until {formatDate(c.earliestApprovalAt)}
            </dd>
          </div>
        )}
        {c.objectedAt && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-rose-700">Objected on {formatDate(c.objectedAt)}</dt>
            <dd className="text-rose-900">{c.objectionNote}</dd>
          </div>
        )}
        {c.pendingApproval && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-slate-500">Proposed</dt>
            <dd className="text-slate-800">
              By {c.pendingApproval.proposedBy ?? "staff"}.{" "}
              <a href="/ops/governed-actions" className="font-medium text-primary-700 hover:text-primary-800">
                Decide it in Approvals
              </a>
            </dd>
          </div>
        )}
      </dl>

      {error && (
        <Alert tone="danger" title="That didn't work" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {canPropose && c.status === "requested" && !c.pendingApproval && (
          <span className="flex items-center gap-2">
            {noticeRunning && <span className="text-xs text-slate-500">Approval possible from {formatDate(c.earliestApprovalAt)}</span>}
            <Button disabled={busy !== null} onClick={propose}>
              {busy === "propose" ? "Proposing…" : "Propose change"}
            </Button>
          </span>
        )}
        {canClose && c.kind === "unreachable" && c.status === "requested" && !noteFor && (
          <Button variant="secondary" onClick={() => setNoteFor("objection")}>
            Objection received…
          </Button>
        )}
        {canClose && (c.status === "requested" || c.status === "objected") && !noteFor && (
          <Button variant="secondary" onClick={() => setNoteFor("close")}>
            Close…
          </Button>
        )}
      </div>
      {noteFor && (
        <div className="mt-3 space-y-2">
          <label htmlFor={`note-${c.id}`} className="block text-xs font-medium text-slate-700">
            {noteFor === "objection"
              ? "What the contact said, how they reached Birr, and how you know it was them"
              : "Why it's being closed (the Founder's members are told it was closed)"}
          </label>
          <textarea maxLength={2000} id={`note-${c.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy !== null} onClick={() => setNoteFor(null)}>
              Cancel
            </Button>
            <Button disabled={busy !== null || note.trim().length < 5} onClick={submitNote}>
              {busy === "close" ? "Saving…" : noteFor === "objection" ? "Record objection" : "Close request"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function RecordForm({ onCancel, onRecorded }: { onCancel: () => void; onRecorded: () => void }) {
  const [founders, setFounders] = useState<Founder[] | null>(null);
  const [founderId, setFounderId] = useState("");
  const [members, setMembers] = useState<FounderMembership[] | null>(null);
  const [choice, setChoice] = useState("new");
  const [newEmail, setNewEmail] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetchJson<Founder[]>("/founders")
      .then(setFounders)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  function pickFounder(id: string) {
    setMembers(null);
    setFounderId(id);
  }

  useEffect(() => {
    if (!founderId) return;
    apiFetchJson<FounderMembership[]>(`/founders/${founderId}/members`)
      .then((m) => {
        setMembers(m);
        const first = m.find((x) => x.status === "active" && x.permissionLevel !== "primary_contact");
        setChoice(first?.id ?? "new");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [founderId]);

  const primary = members?.find((m) => m.permissionLevel === "primary_contact" && m.status === "active");
  const candidates = members?.filter((m) => m.status === "active" && m.permissionLevel !== "primary_contact") ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const person = choice === "new" ? { newEmail: newEmail.trim(), newFullName: newFullName.trim() } : { newMembershipId: choice };
      await apiFetchJson("/staff/founder-succession", {
        method: "POST",
        body: JSON.stringify({ founderId, ...person, reason: reason.trim(), evidenceNote: evidenceNote.trim() }),
      });
      onRecorded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Record a request</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          When family or an institution tells Birr the primary contact can&apos;t act (by phone, letter or visit). Recording it tells the contact at once, by email and
          WhatsApp; they have 7 days to object before the change can be approved.
        </p>
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't record it">
          {error}
        </Alert>
      )}
      <div>
        <label htmlFor="succ-founder" className="mb-1 block text-xs font-medium text-slate-700">
          Founder
        </label>
        <Combobox
          id="succ-founder"
          options={(founders ?? []).map((f) => ({ value: f.id, label: f.name }))}
          value={founderId}
          onChange={pickFounder}
          loading={founders === null}
          placeholder="Search founders…"
        />
        {primary && <p className="mt-1 text-xs text-slate-500">Current primary contact: {primary.user.fullName}</p>}
        {members && !primary && <p className="mt-1 text-xs text-rose-700">This Founder has no active primary contact.</p>}
      </div>
      {members && (
        <>
          <div>
            <label htmlFor="succ-new" className="mb-1 block text-xs font-medium text-slate-700">
              Who takes over
            </label>
            <Select id="succ-new" value={choice} onChange={(e) => setChoice(e.target.value)}>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user.fullName} ({m.user.email})
                </option>
              ))}
              <option value="new">Someone not on the team yet</option>
            </Select>
          </div>
          {choice === "new" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="succ-name" className="mb-1 block text-xs font-medium text-slate-700">
                  Their full name
                </label>
                <input id="succ-name" required value={newFullName} onChange={(e) => setNewFullName(e.target.value)} className={textareaClass} />
              </div>
              <div>
                <label htmlFor="succ-email" className="mb-1 block text-xs font-medium text-slate-700">
                  Their email
                </label>
                <input id="succ-email" type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={textareaClass} />
              </div>
            </div>
          )}
          <div>
            <label htmlFor="succ-reason" className="mb-1 block text-xs font-medium text-slate-700">
              Reason
            </label>
            <textarea maxLength={2000} id="succ-reason" required minLength={10} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
          </div>
          <div>
            <label htmlFor="succ-evidence" className="mb-1 block text-xs font-medium text-slate-700">
              Evidence seen
            </label>
            <textarea
              maxLength={4000}
              id="succ-evidence"
              required
              minLength={10}
              rows={3}
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              placeholder="e.g. Death certificate No. 4471, seen 12 Nov; copy filed."
              className={textareaClass}
            />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !members || !primary}>
          {submitting ? "Recording…" : "Record and notify the contact"}
        </Button>
      </div>
    </form>
  );
}
