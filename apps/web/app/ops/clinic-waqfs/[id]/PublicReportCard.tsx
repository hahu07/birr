"use client";

// A clinic waqf's public page (2026-11-17, clinic slice 8): its fundraising
// targets, and the operator's monthly figures. A Mutawalli Officer records
// a month's figures from the operator's report; Compliance or the Audit
// Committee checks and publishes them, never whoever recorded them. The
// money, and the subsidised visits, come from the ledger and approved
// claims on their own.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ClinicMonthlyReport, WaqfProgramme } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, Input } from "@birr/ui";
import { WAQF_PROGRAMME_PRODUCTS } from "@birr/shared";

const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date()).slice(0, 7);
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const clean = (v: string) => v.replace(/[,\s₦]/g, "");

const TONE: Record<ClinicMonthlyReport["status"], "success" | "warning" | "neutral"> = { draft: "warning", published: "success", discarded: "neutral" };
// The clinic product's fixed monthly measures, from the shared product list.
const MEASURES = WAQF_PROGRAMME_PRODUCTS.clinic.monthlyMeasures.map((m) => [m.key, m.label] as const);

export function PublicReportCard({ clinic, onChange }: { clinic: WaqfProgramme; onChange: () => void }) {
  const { can, staff } = useStaffSession();
  const [reports, setReports] = useState<ClinicMonthlyReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingTargets, setEditingTargets] = useState(false);
  const [recording, setRecording] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<ClinicMonthlyReport[]>(`/waqf-programmes/${clinic.id}/reports`)
      .then(setReports)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [clinic.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      load();
      onChange();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const post = (path: string, body?: object) =>
    run(() => apiFetchJson(`/waqf-programmes/${clinic.id}/reports${path}`, { method: "POST", ...(body && { body: JSON.stringify(body) }) }));

  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Public page</p>
          <p className="text-xs text-slate-500">
            Targets, and the operator&apos;s monthly figures once a second person has checked them.{" "}
            {clinic.status === "established" && (
              <Link href={`/clinics/${clinic.slug}`} className="font-medium text-primary-700 hover:text-primary-800">
                View the page
              </Link>
            )}
          </p>
        </div>
        {can("clinic.report_record") && clinic.status === "established" && !recording && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setRecording(true)}>
            Record a month
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {error}
        </Alert>
      )}

      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        {editingTargets ? (
          <Targets
            clinic={clinic}
            disabled={busy}
            onCancel={() => setEditingTargets(false)}
            onSave={(body) => run(() => apiFetchJson(`/waqf-programmes/${clinic.id}`, { method: "PUT", body: JSON.stringify(body) })).then((ok) => ok && setEditingTargets(false))}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-slate-700">
              Endowment target: <span className="font-medium">{clinic.endowmentTarget ? `₦${formatAmount(clinic.endowmentTarget)}` : "none"}</span> · Running fund a
              month: <span className="font-medium">{clinic.runningMonthlyTarget ? `₦${formatAmount(clinic.runningMonthlyTarget)}` : "none"}</span>
            </p>
            {can("waqf_programme.manage") && (
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditingTargets(true)}>
                Set targets
              </Button>
            )}
          </div>
        )}
      </div>

      {recording && <RecordForm disabled={busy} onCancel={() => setRecording(false)} onSubmit={(body) => post("", body).then((ok) => ok && setRecording(false))} />}

      {reports && reports.length === 0 && !recording && <p className="text-sm text-slate-500">No monthly figures yet.</p>}
      {reports && reports.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {reports.map((r) => (
            <li key={r.id} className="py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-800">{monthName(r.period)}</p>
                  <p className="text-xs text-slate-500">
                    {MEASURES.map(([key, label]) => `${label} ${r[key].toLocaleString("en-NG")}`).join(" · ")}
                  </p>
                  <p className="text-xs text-slate-500">
                    Recorded by {r.recordedByUser?.fullName ?? "staff"}
                    {r.publishedAt ? `; published ${formatDate(r.publishedAt)} by ${r.publishedByUser?.fullName ?? "staff"}` : ""}
                  </p>
                </div>
                <Badge tone={TONE[r.status]}>{humanize(r.status)}</Badge>
              </div>
              {r.status === "draft" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {can("clinic.report_publish") &&
                    (r.recordedByUserId === staff?.userId ? (
                      <span className="text-xs text-slate-500">You recorded these, so someone else publishes them.</span>
                    ) : (
                      <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => post(`/${r.id}/publish`)}>
                        Checked: publish
                      </Button>
                    ))}
                  {can("clinic.report_record") && (
                    <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => post(`/${r.id}/discard`)}>
                      Discard
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Targets({
  clinic,
  disabled,
  onCancel,
  onSave,
}: {
  clinic: WaqfProgramme;
  disabled: boolean;
  onCancel: () => void;
  onSave: (body: { endowmentTarget?: string; runningMonthlyTarget?: string }) => void;
}) {
  const [endowment, setEndowment] = useState(clinic.endowmentTarget ? String(Number(clinic.endowmentTarget)) : "");
  const [running, setRunning] = useState(clinic.runningMonthlyTarget ? String(Number(clinic.runningMonthlyTarget)) : "");
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...(clean(endowment) && { endowmentTarget: clean(endowment) }), ...(clean(running) && { runningMonthlyTarget: clean(running) }) });
      }}
    >
      <div className="w-48 space-y-1">
        <label className="text-xs font-medium text-slate-700">Endowment target (₦)</label>
        <Input inputMode="decimal" maxLength={20} value={endowment} onChange={(e) => setEndowment(e.target.value)} />
      </div>
      <div className="w-48 space-y-1">
        <label className="text-xs font-medium text-slate-700">Running fund a month (₦)</label>
        <Input inputMode="decimal" maxLength={20} value={running} onChange={(e) => setRunning(e.target.value)} />
      </div>
      <Button type="submit" className="px-3 py-1.5 text-xs" disabled={disabled}>
        Save
      </Button>
      <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function RecordForm({ disabled, onCancel, onSubmit }: { disabled: boolean; onCancel: () => void; onSubmit: (body: object) => void }) {
  const [period, setPeriod] = useState(thisMonth());
  const [values, setValues] = useState<Record<string, string>>({ visits: "", childrenImmunised: "", testsRun: "", referrals: "" });
  return (
    <form
      className="mb-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ period, ...Object.fromEntries(MEASURES.map(([key]) => [key, Number(values[key])])) });
      }}
    >
      <p className="text-xs text-slate-500">From the operator&apos;s monthly report. A second person checks them against it before they&apos;re published.</p>
      <div className="flex flex-wrap gap-3">
        <div className="w-40 space-y-1">
          <label className="text-xs font-medium text-slate-700">Month</label>
          <Input required type="month" max={thisMonth()} value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
        {MEASURES.map(([key, label]) => (
          <div key={key} className="w-36 space-y-1">
            <label className="text-xs font-medium text-slate-700">{label}</label>
            <Input required type="number" min={0} max={1_000_000} step={1} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={disabled}>
          Record
        </Button>
      </div>
    </form>
  );
}
