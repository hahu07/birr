"use client";

// A clinic waqf's equipment replacement reserve (2026-11-17, clinic slice 9).
// The Board sets what share of the endowment's income is set aside; each
// income receipt then moves that share into the reserve automatically. The
// reserve pays only for replacing registered equipment, under Endowment
// spending ("Replacing equipment, from the reserve").
import { useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ClinicLedger, WaqfProgramme, GovernedAction } from "../../../../lib/ops-types";
import { Alert, Button, Card, Input } from "@birr/ui";

export function ReserveCard({ clinic, ledger, pending, onChange }: { clinic: WaqfProgramme; ledger: ClinicLedger; pending: GovernedAction[]; onChange: () => void }) {
  const { can } = useStaffSession();
  const [percent, setPercent] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holds = ledger.running.find((r) => r.code === "1150")?.balance ?? "0";
  const spent = ledger.running.find((r) => r.code === "5200")?.balance ?? "0";
  const proposal = pending.find((a) => a.permission.key === "clinic_waqf.reserve_share_set" && (a.payload as Record<string, unknown>)?.programmeId === clinic.id);
  const valid = /^\d{1,3}$/.test(percent) && Number(percent) <= 100;

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      await apiFetchJson("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: "clinic_waqf.reserve_share_set", payload: { programmeId: clinic.id, percent: Number(percent) } }),
      });
      setEditing(false);
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
          <p className="text-sm font-medium text-slate-700">Equipment replacement reserve</p>
          <p className="text-xs text-slate-500">
            A share of the endowment&apos;s income, set aside as it comes in, to replace equipment on the register when it wears out.
          </p>
        </div>
        {can("clinic_waqf.reserve_share_set") && clinic.status === "established" && !proposal && !editing && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setEditing(true)}>
            Change the share
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {error}
        </Alert>
      )}
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Share of income</dt>
          <dd className="font-medium text-slate-900">{clinic.reserveSharePercent ?? 0}%</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Holds</dt>
          <dd className="tabular-nums font-medium text-slate-900">₦{formatAmount(holds)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Spent on replacements</dt>
          <dd className="tabular-nums font-medium text-slate-900">₦{formatAmount(spent)}</dd>
        </div>
      </dl>
      {proposal && (
        <p className="mt-3 text-xs text-slate-500">
          A new share is waiting for the Board in the{" "}
          <Link href="/ops/governed-actions" className="font-medium text-primary-700 hover:text-primary-800">
            Approvals queue
          </Link>
          .
        </p>
      )}
      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="w-32 space-y-1">
            <label className="text-xs font-medium text-slate-700">New share (%)</label>
            <Input type="number" min={0} max={100} step={1} value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <Button className="px-3 py-1.5 text-xs" disabled={busy || !valid} onClick={() => void propose()}>
            Propose to the Board
          </Button>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      )}
    </Card>
  );
}
