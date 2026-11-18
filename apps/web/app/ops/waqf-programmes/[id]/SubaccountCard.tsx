"use client";

// Where a waqf programme's gifts settle (2026-11-18, need-based NB2): its
// own Paystack subaccount, tied to its own bank account. Owner's decision:
// two people decide it, so a platform admin proposes the code and the Board
// of Trustees or Compliance approves it (waqf_programme.subaccount_set). No
// gift is taken until it's set.
import { useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { WaqfProgramme, GovernedAction } from "../../../../lib/ops-types";
import { Alert, Button, Card, Input } from "@birr/ui";

const CODE = /^ACCT_[A-Za-z0-9]+$/;

export function SubaccountCard({ programme, pending, onChange }: { programme: WaqfProgramme; pending: GovernedAction[]; onChange: () => void }) {
  const { can } = useStaffSession();
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = programme.paystackSubaccountCode ?? null;
  const proposal = pending.find((a) => a.permission.key === "waqf_programme.subaccount_set" && (a.payload as Record<string, unknown>)?.programmeId === programme.id);
  const valid = CODE.test(code.trim()) && code.trim() !== current;

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: "waqf_programme.subaccount_set", payload: { programmeId: programme.id, subaccountCode: code.trim() } }),
      });
      setEditing(false);
      setCode("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Where gifts settle</p>
          <p className="text-xs text-slate-500">
            Its own Paystack subaccount, tied to its own bank account, never Birr&apos;s main balance. Two people set it: a platform admin
            proposes, and the Board of Trustees or Compliance approves.
          </p>
        </div>
        {can("waqf_programme.subaccount_set") && !proposal && !editing && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setEditing(true)}>
            {current ? "Change it" : "Set it"}
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {error}
        </Alert>
      )}
      {current ? (
        <p className="text-sm text-slate-900">
          Paystack subaccount <span className="font-mono">{current}</span>
          {programme.paystackSubaccountSetAt && <span className="text-slate-500"> · approved {formatDate(programme.paystackSubaccountSetAt)}</span>}
        </p>
      ) : (
        <p className="text-sm text-slate-600">Not set yet. No gift is taken until it is.</p>
      )}
      {proposal && (
        <p className="mt-3 text-xs text-slate-500">
          A {current ? "change" : "subaccount"} is waiting for approval in the{" "}
          <Link href="/ops/governed-actions" className="font-medium text-primary-700 hover:text-primary-800">
            Approvals queue
          </Link>
          .
        </p>
      )}
      {editing && (
        <div className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <label htmlFor="subaccount-code" className="text-xs font-medium text-slate-700">
            Paystack subaccount code
          </label>
          <Input
            id="subaccount-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ACCT_8f4s1eq7ml6rlzj"
            pattern="ACCT_[A-Za-z0-9]+"
            maxLength={64}
          />
          <p className="text-xs text-slate-500">From Paystack&apos;s Subaccounts page, for this programme&apos;s own bank account.</p>
          <div className="flex gap-2">
            <Button disabled={busy || !valid} onClick={() => void propose()}>
              Propose it
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
