"use client";

// The staged changes, sent as one proposal (owner's decisions, 2026-11-16).
// The review panel runs the safety checks before anything is sent (POST
// /roles/permission-changes/preview), shows how many people each change
// affects, and asks for a reason the Board sees and the audit trail keeps.
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../lib/api";
import type { GrantChange, GrantChangeCheck, RolesOverview } from "../../../lib/ops-types";
import { permissionLabel, settingLabel, settingOf } from "../../../lib/permission-labels";
import { Alert, Button } from "@birr/ui";

const REASON_MIN = 10;

export function StagedChangesBar({
  overview,
  staged,
  onDiscard,
  onUnstage,
  onSent,
}: {
  overview: RolesOverview;
  staged: GrantChange[];
  onDiscard: () => void;
  onUnstage: (change: GrantChange) => void;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const roles = new Set(staged.map((c) => c.roleKey)).size;
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-amber-200 bg-amber-50/95 backdrop-blur lg:left-[17rem]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <p className="text-sm font-medium text-amber-900">
            {staged.length} {staged.length === 1 ? "change" : "changes"} to {roles} {roles === 1 ? "role" : "roles"}, not yet sent
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onDiscard}>
              Discard
            </Button>
            <Button onClick={() => setOpen(true)}>Review &amp; send</Button>
          </div>
        </div>
      </div>
      {open && <ReviewPanel overview={overview} staged={staged} onUnstage={onUnstage} onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  );
}

function ReviewPanel({
  overview,
  staged,
  onUnstage,
  onClose,
  onSent,
}: {
  overview: RolesOverview;
  staged: GrantChange[];
  onUnstage: (change: GrantChange) => void;
  onClose: () => void;
  onSent: () => void;
}) {
  const [checks, setChecks] = useState<GrantChangeCheck[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Re-checked whenever the staged set changes (e.g. one is removed here).
  // Keyed on content: the array itself is new on every render.
  const stagedJson = JSON.stringify(staged);
  useEffect(() => {
    let cancelled = false;
    setChecks(null);
    setCheckError(null);
    apiFetchJson<{ checks: GrantChangeCheck[] }>("/roles/permission-changes/preview", { method: "POST", body: JSON.stringify({ changes: JSON.parse(stagedJson) }) })
      .then((r) => !cancelled && setChecks(r.checks))
      .catch((err: unknown) => !cancelled && setCheckError(err instanceof Error ? err.message : "Couldn't check these changes."));
    return () => {
      cancelled = true;
    };
  }, [stagedJson]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (staged.length === 0) onClose();
  }, [staged.length, onClose]);

  const problems = checks?.filter((c) => c.problem).length ?? 0;
  const canSend = checks !== null && problems === 0 && reason.trim().length >= REASON_MIN && !sending;
  const permissionOf = (key: string) => overview.permissions.find((p) => p.key === key);

  async function send() {
    setSending(true);
    setSendError(null);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: "role.permission_change", payload: { changes: staged, reason: reason.trim() } }),
      });
      onSent();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-changes-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <h2 id="review-changes-title" className="text-lg font-semibold text-slate-900">
            Review {staged.length} {staged.length === 1 ? "change" : "changes"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Sent together as one proposal. A Board member approves or rejects them all on the Approvals page; nothing changes until then.
          </p>
        </div>

        <div className="px-5 py-4 sm:px-6">
          {checkError && (
            <Alert tone="danger" title="Couldn't check these changes" className="mb-4">
              {checkError}
            </Alert>
          )}
          {!checks && !checkError && <p className="text-sm text-slate-500">Checking the safety rules…</p>}
          {checks && problems > 0 && (
            <Alert tone="danger" title={`${problems} ${problems === 1 ? "change" : "changes"} can't be made`} className="mb-4">
              Remove {problems === 1 ? "it" : "them"} below, or change {problems === 1 ? "it" : "them"} in the role, to send the rest.
            </Alert>
          )}
          {checks && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {checks.map((c) => {
                const permission = permissionOf(c.permissionKey);
                const approval = c.requiresMakerChecker;
                return (
                  <li key={`${c.roleKey}:${c.permissionKey}`} className={`px-4 py-3 ${c.problem ? "bg-red-50/60" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {c.roleName ?? c.roleKey} · {permission ? permissionLabel(permission) : c.permissionKey}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          {settingLabel(settingOf(c.before, approval), approval)} → <span className="font-semibold">{settingLabel(settingOf(c, approval), approval)}</span>
                          {" · "}
                          affects {c.affectedPeople} {c.affectedPeople === 1 ? "person" : "people"}
                        </p>
                        {c.problem && <p className="mt-1 text-xs font-medium text-red-700">{c.problem}</p>}
                      </div>
                      <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-800" onClick={() => onUnstage(c)}>
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <label htmlFor="change-reason" className="mb-1.5 mt-5 block text-sm font-medium text-slate-700">
            Why are these changes needed?
          </label>
          <textarea
            id="change-reason"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <p className="mt-1 text-xs text-slate-500">The Board sees this, and it&apos;s kept in the audit trail. At least {REASON_MIN} characters.</p>

          {sendError && (
            <Alert tone="danger" title="Couldn't send for approval" className="mt-4">
              {sendError}{" "}
              {/already awaiting approval/.test(sendError) && (
                <Link href="/ops/governed-actions" className="font-medium underline">
                  Open Approvals
                </Link>
              )}
            </Alert>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4 sm:px-6">
          <Button variant="secondary" onClick={onClose}>
            Keep editing
          </Button>
          <Button onClick={() => void send()} disabled={!canSend}>
            {sending ? "Sending…" : "Send for approval"}
          </Button>
        </div>
      </div>
    </div>
  );
}
