"use client";

// A clinic waqf's price list and subsidy bands (2026-11-17, clinic slice
// 6), versioned like its deed. A Mutawalli Officer drafts a version; the
// Board of Trustees or Compliance approves it in the Approvals queue.
// Monthly claims are checked against the approved version: its prices,
// what share each band's patients pay, and the running fund's monthly cap.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ClinicPriceList, ClinicPriceListContent, GovernedAction } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, Input } from "@birr/ui";

const TONE: Record<ClinicPriceList["status"], "success" | "warning" | "neutral"> = {
  draft: "warning",
  approved: "success",
  superseded: "neutral",
  discarded: "neutral",
};

const clean = (v: string) => v.replace(/[,\s₦]/g, "");

const BLANK: ClinicPriceListContent = {
  services: [{ code: "", name: "", price: "" }],
  bands: [
    { code: "A", name: "", whoQualifies: "", patientSharePercent: 0 },
    { code: "B", name: "", whoQualifies: "", patientSharePercent: 50 },
  ],
  monthlySubsidyCap: "",
};

export function PriceListCard({ clinicWaqfId }: { clinicWaqfId: string }) {
  const { can } = useStaffSession();
  const [lists, setLists] = useState<ClinicPriceList[] | null>(null);
  const [pending, setPending] = useState<GovernedAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ClinicPriceListContent | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<ClinicPriceList[]>(`/clinic-waqfs/${clinicWaqfId}/price-lists`),
      apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed"),
    ])
      .then(([l, a]) => {
        setLists(l);
        setPending(a.filter((x) => x.permission.key === "clinic_waqf.price_list_approve"));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [clinicWaqfId]);

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

  const canManage = can("clinic_waqf.manage");
  const draft = lists?.find((l) => l.status === "draft");
  const latest = lists?.find((l) => l.status !== "discarded");

  function save(content: ClinicPriceListContent) {
    const body = {
      services: content.services.map((s) => ({ ...s, price: clean(s.price) })),
      bands: content.bands.map((b) => ({ ...b, patientSharePercent: Number(b.patientSharePercent) })),
      monthlySubsidyCap: clean(content.monthlySubsidyCap),
    };
    return run(() => apiFetchJson(`/clinic-waqfs/${clinicWaqfId}/price-lists`, { method: "POST", body: JSON.stringify(body) })).then(
      (ok) => ok && setEditing(null),
    );
  }

  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Price list and subsidy bands</p>
          <p className="text-xs text-slate-500">
            What the operator may charge, what share each band&apos;s patients pay, and the most the running fund pays a month. A change is
            a new version, approved by the Board or Compliance.
          </p>
        </div>
        {canManage && lists && !draft && editing === null && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setEditing(latest ? structuredClone(latest.content) : structuredClone(BLANK))}>
            Draft a new version
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {error}
        </Alert>
      )}
      {editing && <Editor value={editing} onChange={setEditing} disabled={busy} onCancel={() => setEditing(null)} onSave={() => void save(editing)} />}
      {lists && lists.length === 0 && !editing && <p className="text-sm text-slate-500">No price list yet. Claims can&apos;t be checked until one is approved.</p>}
      {lists && lists.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {lists.map((list) => {
            const proposal = pending.find((a) => (a.payload as Record<string, unknown>)?.priceListId === list.id);
            return (
              <li key={list.id} className="py-3">
                <details open={list.status === "draft" || (list.status === "approved" && !draft)}>
                  <summary className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-800">
                      Version {list.version}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        drafted {formatDate(list.createdAt)}
                        {list.createdByUser ? ` by ${list.createdByUser.fullName}` : ""}
                        {list.approvedAt ? `; approved ${formatDate(list.approvedAt)}` : ""}
                      </span>
                    </span>
                    <Badge tone={TONE[list.status]}>{humanize(list.status)}</Badge>
                  </summary>
                  <View content={list.content} />
                  {list.status === "draft" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {proposal ? (
                        <p className="text-xs text-slate-500">
                          Waiting for the Board or Compliance in the{" "}
                          <Link href="/ops/governed-actions" className="font-medium text-primary-700 hover:text-primary-800">
                            Approvals queue
                          </Link>
                          .
                        </p>
                      ) : (
                        <>
                          {can("clinic_waqf.price_list_approve") && (
                            <Button
                              className="px-3 py-1.5 text-xs"
                              disabled={busy}
                              onClick={() =>
                                run(() =>
                                  apiFetchJson("/governed-actions", {
                                    method: "POST",
                                    body: JSON.stringify({
                                      permissionKey: "clinic_waqf.price_list_approve",
                                      payload: { priceListId: list.id, contentHash: list.contentHash },
                                    }),
                                  }),
                                )
                              }
                            >
                              Propose for approval
                            </Button>
                          )}
                          {canManage && (
                            <Button
                              variant="secondary"
                              className="px-3 py-1.5 text-xs"
                              disabled={busy}
                              onClick={() => run(() => apiFetchJson(`/clinic-waqfs/${clinicWaqfId}/price-lists/${list.id}/discard`, { method: "POST" }))}
                            >
                              Discard draft
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function View({ content }: { content: ClinicPriceListContent }) {
  return (
    <div className="mt-3 space-y-3 text-sm">
      <table className="w-full text-left">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 font-medium">Code</th>
            <th className="py-1 font-medium">Service</th>
            <th className="py-1 text-right font-medium">Price (₦)</th>
          </tr>
        </thead>
        <tbody>
          {content.services.map((s) => (
            <tr key={s.code} className="border-t border-slate-100">
              <td className="py-1 font-mono text-xs text-slate-600">{s.code}</td>
              <td className="py-1 text-slate-800">{s.name}</td>
              <td className="py-1 text-right tabular-nums text-slate-800">{formatAmount(s.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-1.5">
        {content.bands.map((b) => (
          <li key={b.code} className="rounded-md bg-slate-50 px-3 py-2">
            <p className="text-slate-800">
              Band {b.code}: {b.name} <span className="text-slate-500">· patient pays {b.patientSharePercent}%</span>
            </p>
            <p className="text-xs text-slate-500">{b.whoQualifies}</p>
          </li>
        ))}
      </ul>
      <p className="text-slate-700">
        Monthly subsidy cap: <span className="tabular-nums font-medium">₦{formatAmount(content.monthlySubsidyCap)}</span>
      </p>
    </div>
  );
}

function Editor({
  value,
  onChange,
  disabled,
  onCancel,
  onSave,
}: {
  value: ClinicPriceListContent;
  onChange: (v: ClinicPriceListContent) => void;
  disabled: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const setService = (i: number, patch: Partial<ClinicPriceListContent["services"][number]>) =>
    onChange({ ...value, services: value.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setBand = (i: number, patch: Partial<ClinicPriceListContent["bands"][number]>) =>
    onChange({ ...value, bands: value.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  return (
    <form
      className="mb-4 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Services</p>
        {value.services.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input required className="w-32" maxLength={30} value={s.code} onChange={(e) => setService(i, { code: e.target.value.toUpperCase() })} placeholder="ANC-VISIT" />
            <Input required check="name" className="min-w-[12rem] flex-1" value={s.name} onChange={(e) => setService(i, { name: e.target.value })} placeholder="Antenatal visit" />
            <Input required className="w-32" inputMode="decimal" value={s.price} onChange={(e) => setService(i, { price: e.target.value })} placeholder="₦ price" />
            {value.services.length > 1 && (
              <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => onChange({ ...value, services: value.services.filter((_, j) => j !== i) })}>
                Remove
              </Button>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onChange({ ...value, services: [...value.services, { code: "", name: "", price: "" }] })}>
          Add a service
        </Button>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Subsidy bands</p>
        {value.bands.map((b, i) => (
          <div key={i} className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input required className="w-20" maxLength={30} value={b.code} onChange={(e) => setBand(i, { code: e.target.value.toUpperCase() })} placeholder="A" />
              <Input required check="name" className="min-w-[10rem] flex-1" value={b.name} onChange={(e) => setBand(i, { name: e.target.value })} placeholder="Poorest" />
              <label className="flex items-center gap-1 text-xs text-slate-600">
                Patient pays
                <Input
                  required
                  className="w-16"
                  type="number"
                  min={0}
                  max={100}
                  value={String(b.patientSharePercent)}
                  onChange={(e) => setBand(i, { patientSharePercent: Number(e.target.value) })}
                />
                %
              </label>
              {value.bands.length > 1 && (
                <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => onChange({ ...value, bands: value.bands.filter((_, j) => j !== i) })}>
                  Remove
                </Button>
              )}
            </div>
            <Input
              required
              maxLength={500}
              value={b.whoQualifies}
              onChange={(e) => setBand(i, { whoQualifies: e.target.value })}
              placeholder="Who qualifies, e.g. household income under ₦50,000 a month"
            />
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          onClick={() => onChange({ ...value, bands: [...value.bands, { code: "", name: "", whoQualifies: "", patientSharePercent: 100 }] })}
        >
          Add a band
        </Button>
      </div>
      <div className="w-56 space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">Monthly subsidy cap (₦)</label>
        <Input required inputMode="decimal" maxLength={20} value={value.monthlySubsidyCap} onChange={(e) => onChange({ ...value, monthlySubsidyCap: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={disabled}>
          Save as draft version
        </Button>
      </div>
    </form>
  );
}
