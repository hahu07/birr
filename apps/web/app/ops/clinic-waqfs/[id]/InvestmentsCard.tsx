"use client";

// A clinic waqf's investments (2026-11-17, clinic slice 5c): endowed cash
// invested for income. The Investment Committee records one; a Shariah
// board member screens it (never whoever recorded it); placing it is an
// endowment payment, approved and confirmed under Endowment spending.
// Income goes to the running fund; the principal comes back to the
// endowment when it matures.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ProgrammeInvestment, Counterparty } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, Input, Select } from "@birr/ui";
import { FIELD_LIMITS } from "@birr/shared";

const INSTRUMENTS = ["sukuk", "equity_fund", "real_estate_fund", "murabaha", "other"];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
const clean = (v: string) => v.replace(/[,\s₦]/g, "");

export function InvestmentsCard({ programmeId, established }: { programmeId: string; established: boolean }) {
  const { can } = useStaffSession();
  const [investments, setInvestments] = useState<ProgrammeInvestment[] | null>(null);
  const [partners, setPartners] = useState<Counterparty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    Promise.all([apiFetchJson<ProgrammeInvestment[]>(`/clinic-waqfs/${programmeId}/investments`), apiFetchJson<Counterparty[]>("/counterparties?status=active")])
      .then(([i, c]) => {
        setInvestments(i);
        setPartners(c);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [programmeId]);

  useEffect(() => {
    load();
  }, [load]);

  async function post(path: string, body: object) {
    setError(null);
    setBusy(true);
    try {
      await apiFetchJson(`/clinic-waqfs/${programmeId}/investments${path}`, { method: "POST", body: JSON.stringify(body) });
      load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const canManage = can("clinic_waqf.investment_manage") && established;

  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Investments</p>
          <p className="text-xs text-slate-500">Endowed cash invested for income. Only the income is spent, through the running fund.</p>
        </div>
        {canManage && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Record an investment"}
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {error}
        </Alert>
      )}
      {showForm && <CreateForm partners={partners} disabled={busy} onSubmit={(input) => post("", input).then((ok) => ok && setShowForm(false))} />}
      {investments && investments.length === 0 && !showForm && <p className="text-sm text-slate-500">No investments yet.</p>}
      {investments && investments.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {investments.map((i) => (
            <li key={i.id} className="py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-slate-800">
                    {i.name} <span className="text-slate-500">· {humanize(i.instrumentType)} · {i.counterparty.name}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    ₦{formatAmount(i.amount)} · income so far ₦{formatAmount(i.incomeTotal)}
                    {i.returnedOn ? ` · principal back ${formatDate(i.returnedOn)}` : ""}
                  </p>
                  {i.shariahNote && <p className="text-xs text-slate-500">Shariah: {i.shariahNote}</p>}
                </div>
                <Badge tone={i.status === "placed" ? "success" : i.status === "shariah_rejected" ? "danger" : i.status === "returned" ? "neutral" : "warning"}>
                  {humanize(i.status)}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {i.status === "pending_shariah_review" && can("clinic_waqf.investment_shariah_screen") && (
                  <Screen disabled={busy} onSubmit={(p) => post(`/${i.id}/shariah`, p)} />
                )}
                {i.status === "shariah_approved" && (!i.placement || i.placement.status === "rejected") && canManage && (
                  <OneField label="Placement agreement no." button="Propose placing it" disabled={busy} onSubmit={(v) => post(`/${i.id}/placement`, { agreementReference: v })} />
                )}
                {i.status === "shariah_approved" && i.placement && i.placement.status !== "rejected" && (
                  <p className="text-xs text-slate-500">Placement is under Endowment spending ({humanize(i.placement.status)}).</p>
                )}
                {(i.status === "placed" || i.status === "returned") && can("clinic_waqf.investment_income_record") && (
                  <RecordIncome disabled={busy} onSubmit={(p) => post(`/${i.id}/income`, p)} />
                )}
                {i.status === "placed" && canManage && (
                  <OneField label="Bank reference for the principal" button="Record principal returned" disabled={busy} onSubmit={(v) => post(`/${i.id}/return`, { bankReference: v, returnedOn: today() })} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CreateForm({
  partners,
  disabled,
  onSubmit,
}: {
  partners: Counterparty[];
  disabled: boolean;
  onSubmit: (input: { counterpartyId: string; name: string; instrumentType: string; amount: string; businessDescription: string }) => void;
}) {
  const [counterpartyId, setCounterpartyId] = useState("");
  const [name, setName] = useState("");
  const [instrumentType, setInstrumentType] = useState("sukuk");
  const [amount, setAmount] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  return (
    <form
      className="mb-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ counterpartyId, name, instrumentType, amount: clean(amount), businessDescription });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Name</label>
          <Input required check="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="12-month sukuk" />
        </div>
        <div className="w-44 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Instrument</label>
          <Select value={instrumentType} onChange={(e) => setInstrumentType(e.target.value)} className="w-full">
            {INSTRUMENTS.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">With</label>
          <Select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} className="w-full">
            <option value="">Choose a vetted counterparty…</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Amount (₦)</label>
          <Input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">What the money does (for the Shariah reviewer)</label>
        <Input required maxLength={FIELD_LIMITS.longText} value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || !counterpartyId}>
          Record it
        </Button>
      </div>
    </form>
  );
}

function Screen({ disabled, onSubmit }: { disabled: boolean; onSubmit: (p: { decision: "approved" | "rejected"; note: string }) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="min-w-[14rem] flex-1 space-y-1">
        <label className="text-xs font-medium text-slate-700">Shariah screening note</label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button className="px-3 py-1.5 text-xs" disabled={disabled || !note.trim()} onClick={() => onSubmit({ decision: "approved", note: note.trim() })}>
        Approve
      </Button>
      <Button variant="danger" className="px-3 py-1.5 text-xs" disabled={disabled || !note.trim()} onClick={() => onSubmit({ decision: "rejected", note: note.trim() })}>
        Reject
      </Button>
    </div>
  );
}

function OneField({ label, button, disabled, onSubmit }: { label: string; button: string; disabled: boolean; onSubmit: (value: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  if (!open) {
    return (
      <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={disabled} onClick={() => setOpen(true)}>
        {button}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="min-w-[12rem] space-y-1">
        <label className="text-xs font-medium text-slate-700">{label}</label>
        <Input check="reference" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button className="px-3 py-1.5 text-xs" disabled={disabled || !value.trim()} onClick={() => onSubmit(value.trim()).then((ok) => ok && setOpen(false))}>
        {button}
      </Button>
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

function RecordIncome({ disabled, onSubmit }: { disabled: boolean; onSubmit: (p: { amount: string; receivedOn: string; bankReference: string; description: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [description, setDescription] = useState("");
  if (!open) {
    return (
      <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={disabled} onClick={() => setOpen(true)}>
        Record income
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="w-36 space-y-1">
        <label className="text-xs font-medium text-slate-700">Amount (₦)</label>
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="w-44 space-y-1">
        <label className="text-xs font-medium text-slate-700">Bank reference</label>
        <Input check="reference" value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
      </div>
      <div className="min-w-[12rem] flex-1 space-y-1">
        <label className="text-xs font-medium text-slate-700">What it is</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Quarterly profit share" />
      </div>
      <Button
        className="px-3 py-1.5 text-xs"
        disabled={disabled || !amount || !bankReference.trim() || !description.trim()}
        onClick={() => onSubmit({ amount: clean(amount), receivedOn: today(), bankReference: bankReference.trim(), description: description.trim() }).then((ok) => ok && setOpen(false))}
      >
        Record into the running fund
      </Button>
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
