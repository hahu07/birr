"use client";

// Primary contact succession (2026-11-15). The primary contact can ask to
// hand the role to someone else; any other member can report that the
// primary contact can't act any more (died, incapacitated, unreachable).
// Neither changes anything by itself: Birr confirms, with two staff, and
// for a "can't act" report the primary contact is told first and has 7
// days to object. The backend checks who may do what; this only hides
// what the viewer couldn't do anyway.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import type { FounderMembership, PrimaryContactSuccession } from "../../../lib/types";
import { Alert, Badge, Button, Select, Input } from "@birr/ui";
import { Panel, PanelHeader } from "../_components/ui";
import { Field, inputClass } from "../_components/form";

const OPEN: PrimaryContactSuccession["status"][] = ["requested", "approved", "objected"];

const STATUS_TONE: Record<PrimaryContactSuccession["status"], "success" | "warning" | "danger" | "neutral"> = {
  requested: "warning",
  approved: "warning",
  objected: "danger",
  completed: "success",
  rejected: "neutral",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<PrimaryContactSuccession["status"], string> = {
  requested: "Waiting for Birr",
  approved: "Waiting for them to accept",
  objected: "Objected",
  completed: "Done",
  rejected: "Not approved",
  cancelled: "Withdrawn",
};

export function incomingName(s: PrimaryContactSuccession): string {
  return s.newMembership?.user.fullName ?? s.newFullName ?? "someone new";
}

export function SuccessionSection({
  members,
  userId,
  isPrimaryContact,
  onChanged,
}: {
  members: FounderMembership[];
  userId: string | undefined;
  isPrimaryContact: boolean;
  onChanged: () => void;
}) {
  const [cases, setCases] = useState<PrimaryContactSuccession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<"handover" | "unavailable" | null>(null);

  const load = useCallback(() => {
    apiFetchJson<PrimaryContactSuccession[]>("/founder-succession")
      .then(setCases)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    setForm(null);
    load();
    onChanged();
  };

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load primary contact changes">
        {error}
      </Alert>
    );
  }
  if (cases === null) return null;

  const open = cases.find((c) => OPEN.includes(c.status));
  const history = cases.filter((c) => c !== open).slice(0, 5);
  const primary = members.find((m) => m.permissionLevel === "primary_contact" && m.status === "active");

  return (
    <Panel>
      <PanelHeader title="Primary contact" />
      <div className="space-y-4 p-5">
        <p className="text-sm text-slate-600">
          {primary ? (
            <>
              <span className="font-semibold text-slate-900">{primary.user.fullName}</span> is your primary contact: the one person who can give, sign
              your Foundation Deed, set cause allocations and invite others.
            </>
          ) : (
            "You have no primary contact right now."
          )}
        </p>

        {open ? (
          <OpenCase succession={open} userId={userId} onChanged={refresh} />
        ) : form ? (
          <SuccessionForm kind={form} members={members} userId={userId} onDone={refresh} onCancel={() => setForm(null)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {isPrimaryContact ? (
              <Button variant="secondary" className="rounded-lg" onClick={() => setForm("handover")}>
                Hand over primary contact…
              </Button>
            ) : (
              primary && (
                <Button variant="secondary" className="rounded-lg" onClick={() => setForm("unavailable")}>
                  Our primary contact can&apos;t act…
                </Button>
              )
            )}
          </div>
        )}

        {history.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Earlier changes</h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {history.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="text-slate-700">
                    {c.outgoingMembership.user.fullName} → {incomingName(c)}
                    <span className="text-slate-500"> · {formatDate(c.completedAt ?? c.createdAt)}</span>
                  </span>
                  <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function OpenCase({ succession: s, userId, onChanged }: { succession: PrimaryContactSuccession; userId: string | undefined; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const isOutgoing = s.outgoingMembership.user.id === userId;
  const isRequester = s.requestedByUserId === userId;
  const canObject = isOutgoing && s.kind === "unreachable" && s.status === "requested";

  async function post(path: string, body?: unknown) {
    setError(null);
    setBusy(true);
    try {
      await apiFetchJson(`/founder-succession/${s.id}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const who = `${s.outgoingMembership.user.fullName} → ${incomingName(s)}`;
  let message: string;
  if (s.status === "objected") {
    message = `${s.outgoingMembership.user.fullName} objected, so nothing changes. Birr will look into it and contact you.`;
  } else if (s.status === "approved") {
    message = `Birr approved this. We've invited ${incomingName(s)} (${s.newEmail}); they become primary contact when they accept.${
      s.kind === "handover" ? ` Until then ${s.outgoingMembership.user.fullName} stays primary contact.` : ""
    }`;
  } else if (s.kind === "unreachable") {
    message = `Reported on ${formatDate(s.createdAt)} that ${s.outgoingMembership.user.fullName} can't act. They've been told, and can object until ${formatDate(
      s.earliestApprovalAt,
    )}. Birr checks the evidence and decides after that, with two staff.`;
  } else {
    message = `${s.outgoingMembership.user.fullName} asked on ${formatDate(s.createdAt)} to hand over. Nothing changes until Birr confirms, with two staff.`;
  }

  return (
    <div className={`rounded-xl border p-4 ${canObject ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{who}</p>
        <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
      </div>
      <p className="mt-1.5 text-sm text-slate-700">{message}</p>
      <p className="mt-2 text-xs text-slate-500">Reason given: “{s.reason}”</p>
      {error && (
        <Alert tone="danger" title="That didn't work" className="mt-3">
          {error}
        </Alert>
      )}

      {canObject && (
        <form
          className="mt-4 border-t border-red-200 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            post("object", { note: note.trim() });
          }}
        >
          <p className="text-sm font-semibold text-red-900">Someone has asked Birr to replace you as primary contact.</p>
          <p className="mt-0.5 text-sm text-red-800">If this is wrong, tell us now. Birr won&apos;t make the change while you object.</p>
          <Field label="Why this is wrong" htmlFor="succession-objection">
            <textarea
              id="succession-objection"
              required
              minLength={5}
              maxLength={2000}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="mt-3 flex justify-end">
            <Button type="submit" disabled={busy || note.trim().length < 5} className="rounded-lg font-semibold">
              {busy ? "Sending…" : "Object"}
            </Button>
          </div>
        </form>
      )}

      {isRequester && s.status === "requested" && (
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => post("cancel")}>
            {busy ? "Withdrawing…" : "Withdraw request"}
          </Button>
        </div>
      )}
    </div>
  );
}

function SuccessionForm({
  kind,
  members,
  userId,
  onDone,
  onCancel,
}: {
  kind: "handover" | "unavailable";
  members: FounderMembership[];
  userId: string | undefined;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Anyone active who isn't the primary contact can take over. Reporting
  // the contact gone, you can name yourself.
  const candidates = members.filter((m) => m.status === "active" && m.permissionLevel !== "primary_contact");
  const [choice, setChoice] = useState<string>(candidates[0]?.id ?? "new");
  const [newEmail, setNewEmail] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const person = choice === "new" ? { newEmail: newEmail.trim(), newFullName: newFullName.trim() } : { newMembershipId: choice };
      await apiFetchJson(`/founder-succession/${kind}`, {
        method: "POST",
        body: JSON.stringify({ ...person, reason: reason.trim(), ...(kind === "unavailable" ? { evidenceNote: evidenceNote.trim() } : {}) }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const handover = kind === "handover";
  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-base font-semibold text-slate-900">{handover ? "Hand over primary contact" : "Our primary contact can't act"}</h3>
      <p className="mt-0.5 text-sm text-slate-500">
        {handover
          ? "Birr confirms the change with two staff before it takes effect. You stay primary contact until then, and become a viewer afterwards."
          : "For when your primary contact has died, is too unwell, or can't be reached. We tell them first and give them 7 days to object; then two Birr staff check the evidence and decide."}
      </p>
      {error && (
        <Alert tone="danger" title="Couldn't send your request" className="mt-4">
          {error}
        </Alert>
      )}
      <div className="mt-4 space-y-4">
        <Field label="Who takes over" htmlFor="succession-new">
          <Select id="succession-new" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.fullName}
                {m.user.id === userId ? " (you)" : ""}
              </option>
            ))}
            <option value="new">Someone not on the team yet</option>
          </Select>
        </Field>
        {choice === "new" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Their full name" htmlFor="succession-name">
              <Input check="name" id="succession-name" required minLength={2} value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
            </Field>
            <Field label="Their email" htmlFor="succession-email" hint="Birr invites them once it approves.">
              <Input id="succession-email" type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Reason" htmlFor="succession-reason">
          <textarea
            id="succession-reason"
            required
            minLength={10}
            maxLength={2000}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={handover ? "e.g. I retire as Bursar on 31 December." : "e.g. Our chairman, Alhaji Musa, passed away on 2 November."}
            className={inputClass}
          />
        </Field>
        {!handover && (
          <Field label="Evidence you can give Birr" htmlFor="succession-evidence" hint="What you have, e.g. a death certificate, a board resolution, a doctor's letter. Birr may ask to see it.">
            <textarea
              id="succession-evidence"
              required
              minLength={10}
              maxLength={4000}
              rows={3}
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2.5">
        <Button type="button" variant="secondary" onClick={onCancel} className="rounded-lg">
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} className="rounded-lg font-semibold">
          {submitting ? "Sending…" : "Send to Birr"}
        </Button>
      </div>
    </form>
  );
}
