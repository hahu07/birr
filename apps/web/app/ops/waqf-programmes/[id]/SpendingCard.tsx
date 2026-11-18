"use client";

// A clinic waqf's endowment spending (2026-11-17, clinic slice 5b): buying
// equipment, and paying building or renovation work stage by stage, out of
// endowment cash. The Board approves a works project's route and budget;
// the Board or Compliance approves each payment; it's paid by bank transfer
// from the clinic waqf's account; Compliance or the Audit Committee
// confirms the bank reference, which books it. Never more than the
// endowment's free cash, nor a project's budget. Replacing registered
// equipment from the equipment replacement reserve (slice 9) goes the same
// way, limited by the reserve instead; the old item is retired once paid.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ProgrammeAsset, ProgrammeSpend, ProgrammeWorksProject, Counterparty, GovernedAction } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, Input, Select } from "@birr/ui";
import { FIELD_LIMITS } from "@birr/shared";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
const SPEND_TONE: Record<ProgrammeSpend["status"], "success" | "warning" | "neutral" | "danger"> = {
  pending_approval: "warning",
  approved: "warning",
  rejected: "neutral",
  paid: "success",
};
const clean = (v: string) => v.replace(/[,\s₦]/g, "");

/**
 * `kinds`: the endowment payments this programme's product makes
 * (WAQF_PROGRAMME_PRODUCTS[product].spendKinds). A need-based waqf makes
 * investment placements only, proposed from the Investments card, so it
 * gets no works or payment forms here; its placements still show below.
 */
export function SpendingCard({ programmeId, established, kinds }: { programmeId: string; established: boolean; kinds: readonly ProgrammeSpend["kind"][] }) {
  const { can } = useStaffSession();
  const hasWorks = kinds.includes("works_stage");
  const hasPayments = kinds.some((k) => k !== "investment");
  const [works, setWorks] = useState<ProgrammeWorksProject[] | null>(null);
  const [spends, setSpends] = useState<ProgrammeSpend[] | null>(null);
  const [partners, setPartners] = useState<Counterparty[]>([]);
  const [equipment, setEquipment] = useState<ProgrammeAsset[]>([]);
  const [pending, setPending] = useState<GovernedAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<"none" | "works" | "spend">("none");

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<ProgrammeWorksProject[]>(`/waqf-programmes/${programmeId}/works`),
      apiFetchJson<ProgrammeSpend[]>(`/waqf-programmes/${programmeId}/spends`),
      apiFetchJson<Counterparty[]>("/counterparties?status=active"),
      apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed"),
      apiFetchJson<ProgrammeAsset[]>(`/waqf-programmes/${programmeId}/assets`),
    ])
      .then(([w, s, c, actions, a]) => {
        setWorks(w);
        setSpends(s);
        setPartners(c);
        setEquipment(a.filter((x) => x.kind === "equipment" && x.status === "active"));
        setPending(actions.filter((a) => a.permission.key.startsWith("waqf_programme.") || a.permission.key.startsWith("clinic.")));
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
  const waiting = (key: string, field: string, id: string) => pending.some((a) => a.permission.key === key && (a.payload as Record<string, unknown>)?.[field] === id);
  const canManage = can("waqf_programme.manage") && established;

  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Endowment spending</p>
          <p className="text-xs text-slate-500">
            {hasPayments
              ? "Equipment and building work, paid from endowment cash by bank transfer from the programme's own account."
              : "Placements of endowment cash in investments, approved, paid by bank transfer and confirmed here."}
          </p>
        </div>
        {canManage && hasPayments && (
          <div className="flex shrink-0 gap-2">
            {hasWorks && (
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setForm(form === "works" ? "none" : "works")}>
                Propose works
              </Button>
            )}
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setForm(form === "spend" ? "none" : "spend")}>
              New payment
            </Button>
          </div>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {error}
        </Alert>
      )}
      {form === "works" && (
        <WorksForm
          partners={partners}
          disabled={busy}
          onSubmit={(input) => run(() => apiFetchJson(`/waqf-programmes/${programmeId}/works`, { method: "POST", body: JSON.stringify(input) })).then((ok) => ok && setForm("none"))}
        />
      )}
      {form === "spend" && works && (
        <SpendForm
          equipment={equipment}
          partners={partners}
          works={works.filter((w) => w.status === "approved")}
          disabled={busy}
          onSubmit={(input) => run(() => apiFetchJson(`/waqf-programmes/${programmeId}/spends`, { method: "POST", body: JSON.stringify(input) })).then((ok) => ok && setForm("none"))}
        />
      )}

      {works && works.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Works projects</p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {works.map((w) => {
              const spent = w.spends.reduce((t, s) => t + Number(s.amount), 0);
              return (
                <li key={w.id} className="px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-slate-800">{w.name}</p>
                      <p className="text-xs text-slate-500">
                        {humanize(w.route)} · {w.contractor.name} · ₦{formatAmount(String(spent))} of ₦{formatAmount(w.budget)} committed
                      </p>
                    </div>
                    <Badge tone={w.status === "approved" ? "success" : w.status === "rejected" ? "neutral" : "warning"}>{humanize(w.status)}</Badge>
                  </div>
                  {w.status === "proposed" &&
                    (waiting("waqf_programme.works_approve", "worksProjectId", w.id) ? (
                      <p className="mt-1 text-xs text-slate-500">Waiting for the Board.</p>
                    ) : (
                      can("waqf_programme.works_approve") && (
                        <Button className="mt-2 px-3 py-1.5 text-xs" disabled={busy} onClick={() => propose("waqf_programme.works_approve", { worksProjectId: w.id })}>
                          Propose to the Board
                        </Button>
                      )
                    ))}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {spends && spends.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {spends.map((s) => (
            <li key={s.id} className="py-2.5 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-slate-800">
                    ₦{formatAmount(s.amount)} to {s.payee.name}: {s.description}
                  </p>
                  <p className="text-xs text-slate-500">
                    {s.kind === "works_stage"
                      ? `${s.worksProject?.name} · engineer's certificate`
                      : s.kind === "investment"
                        ? "Investment placement · agreement"
                        : s.kind === "reserve_replacement"
                          ? `From the reserve, replacing ${s.replacesAsset?.name ?? "equipment"} · invoice`
                          : "Equipment · invoice"}{" "}
                    {s.supportingReference}
                    {s.paidOn ? ` · paid ${formatDate(s.paidOn)}, bank reference ${s.bankReference}` : ""}
                  </p>
                </div>
                <Badge tone={SPEND_TONE[s.status]}>{humanize(s.status)}</Badge>
              </div>
              {s.status === "pending_approval" &&
                (waiting("waqf_programme.spend_approve", "spendId", s.id) ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Waiting for approval in the <Link href="/ops/governed-actions" className="font-medium text-primary-700">Approvals queue</Link>.
                  </p>
                ) : (
                  can("waqf_programme.spend_approve") && (
                    <Button className="mt-2 px-3 py-1.5 text-xs" disabled={busy} onClick={() => propose("waqf_programme.spend_approve", { spendId: s.id })}>
                      Propose for approval
                    </Button>
                  )
                ))}
              {s.status === "approved" &&
                (waiting("waqf_programme.spend_mark_paid", "spendId", s.id) ? (
                  <p className="mt-1 text-xs text-slate-500">Payment waiting for confirmation.</p>
                ) : (
                  can("waqf_programme.spend_mark_paid") && <MarkPaid disabled={busy} onSubmit={(p) => propose("waqf_programme.spend_mark_paid", { spendId: s.id, ...p })} />
                ))}
            </li>
          ))}
        </ul>
      )}
      {spends && spends.length === 0 && (!works || works.length === 0) && form === "none" && (
        <p className="text-sm text-slate-500">Nothing spent from the endowment yet.</p>
      )}
    </Card>
  );
}

function PartnerSelect({ partners, value, onChange }: { partners: Counterparty[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
      <option value="">Choose a vetted partner…</option>
      {partners.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

function WorksForm({
  partners,
  disabled,
  onSubmit,
}: {
  partners: Counterparty[];
  disabled: boolean;
  onSubmit: (input: { name: string; route: ProgrammeWorksProject["route"]; contractorId: string; budget: string; budgetNote: string }) => void;
}) {
  const [name, setName] = useState("");
  const [route, setRoute] = useState<ProgrammeWorksProject["route"]>("build_on_donated_land");
  const [contractorId, setContractorId] = useState("");
  const [budget, setBudget] = useState("");
  const [budgetNote, setBudgetNote] = useState("");
  return (
    <form
      className="mb-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, route, contractorId, budget: clean(budget), budgetNote });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Project</label>
          <Input required check="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Clinic building, phase 1" />
        </div>
        <div className="w-56 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Route</label>
          <Select value={route} onChange={(e) => setRoute(e.target.value as ProgrammeWorksProject["route"])} className="w-full">
            <option value="build_on_donated_land">Build on donated land</option>
            <option value="build_on_bought_land">Build on bought land</option>
            <option value="renovate">Renovate a building</option>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Contractor</label>
          <PartnerSelect partners={partners} value={contractorId} onChange={setContractorId} />
        </div>
        <div className="w-48 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Budget (₦)</label>
          <Input required inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">Costing and why this route</label>
        <Input required maxLength={FIELD_LIMITS.longText} value={budgetNote} onChange={(e) => setBudgetNote(e.target.value)} placeholder="The quantity surveyor's bill of quantities, and the comparison of routes" />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || !contractorId}>
          Save project
        </Button>
      </div>
    </form>
  );
}

function SpendForm({
  equipment,
  partners,
  works,
  disabled,
  onSubmit,
}: {
  equipment: ProgrammeAsset[];
  partners: Counterparty[];
  works: ProgrammeWorksProject[];
  disabled: boolean;
  onSubmit: (input: {
    kind: ProgrammeSpend["kind"];
    worksProjectId?: string;
    replacesAssetId?: string;
    payeeId: string;
    description: string;
    amount: string;
    supportingReference: string;
  }) => void;
}) {
  const [kind, setKind] = useState<ProgrammeSpend["kind"]>("equipment");
  const [worksProjectId, setWorksProjectId] = useState("");
  const [replacesAssetId, setReplacesAssetId] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [supportingReference, setSupportingReference] = useState("");
  const project = works.find((w) => w.id === worksProjectId);
  return (
    <form
      className="mb-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          kind,
          ...(kind === "works_stage" && { worksProjectId }),
          ...(kind === "reserve_replacement" && { replacesAssetId }),
          payeeId: kind === "works_stage" ? (project?.contractor.id ?? "") : payeeId,
          description,
          amount: clean(amount),
          supportingReference,
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <div className="w-48 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">For</label>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ProgrammeSpend["kind"])} className="w-full">
            <option value="equipment">Equipment</option>
            <option value="works_stage">A works stage</option>
            <option value="reserve_replacement">Replacing equipment, from the reserve</option>
          </Select>
        </div>
        {kind === "reserve_replacement" && (
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Equipment it replaces</label>
            <Select value={replacesAssetId} onChange={(e) => setReplacesAssetId(e.target.value)} className="w-full">
              <option value="">Choose…</option>
              {equipment.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (₦{formatAmount(a.value)})
                </option>
              ))}
            </Select>
          </div>
        )}
        {kind === "works_stage" ? (
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Approved project</label>
            <Select value={worksProjectId} onChange={(e) => setWorksProjectId(e.target.value)} className="w-full">
              <option value="">Choose…</option>
              {works.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.contractor.name})
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Supplier</label>
            <PartnerSelect partners={partners} value={payeeId} onChange={setPayeeId} />
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">What it&apos;s for</label>
        <Input required maxLength={FIELD_LIMITS.longText} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === "works_stage" ? "Foundations" : "Haematology analyser"} />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="w-48 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Amount (₦)</label>
          <Input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">{kind === "works_stage" ? "Engineer's certificate no." : "Invoice no."}</label>
          <Input required check="reference" value={supportingReference} onChange={(e) => setSupportingReference(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || (kind === "works_stage" ? !project : !payeeId) || (kind === "reserve_replacement" && !replacesAssetId)}>
          Save payment
        </Button>
      </div>
    </form>
  );
}

function MarkPaid({ disabled, onSubmit }: { disabled: boolean; onSubmit: (p: { bankReference: string; paidOn: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [bankReference, setBankReference] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  if (!open) {
    return (
      <Button variant="secondary" className="mt-2 px-3 py-1.5 text-xs" disabled={disabled} onClick={() => setOpen(true)}>
        Record the bank transfer
      </Button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="min-w-[12rem] flex-1 space-y-1">
        <label className="text-xs font-medium text-slate-700">Bank reference</label>
        <Input value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
      </div>
      <div className="w-40 space-y-1">
        <label className="text-xs font-medium text-slate-700">Paid on</label>
        <Input type="date" max={today()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </div>
      <Button className="px-3 py-1.5 text-xs" disabled={disabled || bankReference.trim().length < 3} onClick={() => onSubmit({ bankReference: bankReference.trim(), paidOn }).then((ok) => ok && setOpen(false))}>
        Send for confirmation
      </Button>
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
