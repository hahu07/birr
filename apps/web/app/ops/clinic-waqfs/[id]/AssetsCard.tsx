"use client";

// A clinic waqf's asset register (2026-11-17, clinic slice 5a): land, a
// building or equipment given in kind. A Mutawalli Officer records one at
// its independent valuation and proposes adding it; the Board approves on
// the Approvals page, which books it to the endowment. Disposing of one is
// the Board's decision too, with any proceeds kept in the endowment. What
// an asset is and its value never change; its care details can.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ProgrammeAsset, GovernedAction } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, EmptyState, Input, Select } from "@birr/ui";
import { FIELD_LIMITS } from "@birr/shared";

const KINDS: ProgrammeAsset["kind"][] = ["land", "building", "equipment", "vehicle", "other"];
const STATUS_TONE: Record<ProgrammeAsset["status"], "success" | "warning" | "neutral" | "danger"> = {
  proposed: "warning",
  active: "success",
  rejected: "neutral",
  disposed: "neutral",
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());

export function AssetsCard({ programmeId, established }: { programmeId: string; established: boolean }) {
  const { can } = useStaffSession();
  const [assets, setAssets] = useState<ProgrammeAsset[] | null>(null);
  const [pending, setPending] = useState<GovernedAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    Promise.all([apiFetchJson<ProgrammeAsset[]>(`/waqf-programmes/${programmeId}/assets`), apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed")])
      .then(([a, actions]) => {
        setAssets(a);
        setPending(actions.filter((x) => x.permission.key === "waqf_programme.asset_add" || x.permission.key === "waqf_programme.asset_dispose"));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [programmeId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const propose = (permissionKey: string, payload: object) =>
    run(() => apiFetchJson("/governed-actions", { method: "POST", body: JSON.stringify({ permissionKey, payload }) }));
  const waiting = (key: string, assetId: string) => pending.some((a) => a.permission.key === key && (a.payload as { assetId?: string })?.assetId === assetId);
  const canManage = can("waqf_programme.manage");

  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Assets</p>
          <p className="text-xs text-slate-500">
            Premises and equipment the endowment owns. A gift in kind joins it at its valuation once the Board approves.
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Record a gift in kind"}
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {error}
        </Alert>
      )}
      {showForm && canManage && (
        <RecordAssetForm
          disabled={busy}
          onSubmit={(input) =>
            run(() => apiFetchJson(`/waqf-programmes/${programmeId}/assets`, { method: "POST", body: JSON.stringify(input) })).then((ok) => ok && setShowForm(false))
          }
        />
      )}
      {assets && assets.length === 0 && !showForm && <EmptyState title="No assets yet" description="Record land, a building or equipment someone gives." />}
      {assets && assets.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {assets.map((a) => (
            <li key={a.id} className="py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-800">
                    {a.name} <span className="font-normal text-slate-500">({humanize(a.kind)})</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    ₦{formatAmount(a.value)} · given {formatDate(a.acquiredOn)}
                    {a.donorName ? ` by ${a.donorName}` : ""}
                    {a.serialNumber ? ` · serial ${a.serialNumber}` : ""}
                    {a.location ? ` · ${a.location}` : ""}
                    {a.nextServiceDue ? ` · next service ${formatDate(a.nextServiceDue)}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">Valuation: {a.valuationNote}</p>
                  {a.status === "disposed" && (
                    <p className="text-xs text-slate-500">
                      Disposed of {a.disposedOn ? formatDate(a.disposedOn) : ""}, bringing ₦{formatAmount(a.disposalProceeds ?? "0")} into the endowment: {a.disposalNote}
                    </p>
                  )}
                </div>
                <Badge tone={STATUS_TONE[a.status]}>{humanize(a.status)}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {a.status === "proposed" &&
                  (waiting("waqf_programme.asset_add", a.id) ? (
                    <p className="text-xs text-slate-500">
                      Waiting for the Board in the{" "}
                      <Link href="/ops/governed-actions" className="font-medium text-primary-700">
                        Approvals queue
                      </Link>
                      .
                    </p>
                  ) : (
                    can("waqf_programme.asset_add") &&
                    (established ? (
                      <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => propose("waqf_programme.asset_add", { assetId: a.id })}>
                        Propose adding it to the endowment
                      </Button>
                    ) : (
                      <p className="text-xs text-slate-500">It can be added once the clinic waqf is established.</p>
                    ))
                  ))}
                {a.status === "active" &&
                  (waiting("waqf_programme.asset_dispose", a.id) ? (
                    <p className="text-xs text-slate-500">Disposal is waiting for the Board.</p>
                  ) : (
                    can("waqf_programme.asset_dispose") && <DisposeButton disabled={busy} onSubmit={(p) => propose("waqf_programme.asset_dispose", { assetId: a.id, ...p })} />
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface RecordAssetInput {
  kind: ProgrammeAsset["kind"];
  name: string;
  value: string;
  valuationNote: string;
  donorName?: string;
  acquiredOn: string;
  serialNumber?: string;
  location?: string;
}

function RecordAssetForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (input: RecordAssetInput) => void }) {
  const [kind, setKind] = useState<ProgrammeAsset["kind"]>("land");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [valuationNote, setValuationNote] = useState("");
  const [donorName, setDonorName] = useState("");
  const [acquiredOn, setAcquiredOn] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [location, setLocation] = useState("");

  return (
    <form
      className="mb-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          kind,
          name,
          value: value.replace(/[,\s₦]/g, ""),
          valuationNote,
          donorName: donorName || undefined,
          acquiredOn,
          serialNumber: serialNumber || undefined,
          location: location || undefined,
        });
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-40 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Kind</label>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ProgrammeAsset["kind"])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {humanize(k)}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">What it is</label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Plot at Bodija" />
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-48 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Valued at (₦)</label>
          <Input required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="w-44 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Given on</label>
          <Input required type="date" max={today()} value={acquiredOn} onChange={(e) => setAcquiredOn(e.target.value)} />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Given by (optional)</label>
          <Input check="name" value={donorName} onChange={(e) => setDonorName(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">Valuation and title</label>
        <Input
          required
          maxLength={FIELD_LIMITS.longText}
          value={valuationNote}
          onChange={(e) => setValuationNote(e.target.value)}
          placeholder="Who valued it and their report reference; for land, the title documents seen"
        />
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Serial number (equipment)</label>
          <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Where it is</label>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled}>
          Record it
        </Button>
      </div>
    </form>
  );
}

function DisposeButton({ disabled, onSubmit }: { disabled: boolean; onSubmit: (p: { disposedOn: string; proceeds: string; note: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [disposedOn, setDisposedOn] = useState(today());
  const [proceeds, setProceeds] = useState("0");
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={disabled} onClick={() => setOpen(true)}>
        Propose disposal
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="w-40 space-y-1">
        <label className="text-xs font-medium text-slate-700">Disposed of on</label>
        <Input type="date" max={today()} value={disposedOn} onChange={(e) => setDisposedOn(e.target.value)} />
      </div>
      <div className="w-36 space-y-1">
        <label className="text-xs font-medium text-slate-700">Proceeds (₦)</label>
        <Input inputMode="decimal" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
      </div>
      <div className="min-w-[14rem] flex-1 space-y-1">
        <label className="text-xs font-medium text-slate-700">Why, and how</label>
        <Input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Beyond repair; sold to a registered dealer" />
      </div>
      <Button
        className="px-3 py-1.5 text-xs"
        disabled={disabled || note.trim().length < 10}
        onClick={() => onSubmit({ disposedOn, proceeds: proceeds.replace(/[,\s₦]/g, ""), note: note.trim() }).then((ok) => ok && setOpen(false))}
      >
        Propose to the Board
      </Button>
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
