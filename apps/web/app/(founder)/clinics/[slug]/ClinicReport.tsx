"use client";

// A clinic waqf's public report (2026-11-17, clinic slice 8): its targets,
// and the endowment, the running fund and zakah, each shown on its own,
// with the operator's monthly figures once a second person at Birr has
// checked and published them. Fixed measures only; nothing about any giver
// or patient.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatMoney } from "../../../../lib/format";
import { Card } from "@birr/ui";

interface PublicClinicReport {
  currency: string;
  targets: { endowment: string | null; runningMonthly: string | null };
  endowment: { endowed: string; cash: string; invested: string; premisesAndEquipment: string };
  running: {
    gifts: string;
    endowmentIncome: string;
    receivedThisMonth: string;
    subsidisedVisits: string;
    runningCosts: string;
    cash: string;
    equipmentReserve: string;
    spentOnReplacements: string;
  };
  zakah: { paidForPatients: string };
  months: {
    period: string;
    figures: { visits: number; childrenImmunised: number; testsRun: number; referrals: number } | null;
    subsidised: { patients: number; byService: { service: string; visits: number }[]; fromRunningFund: string; fromZakah: string } | null;
  }[];
}

const naira = (amount: string) => formatMoney(amount, "NGN", { decimals: 0 });
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function Progress({ label, value, target }: { label: string; value: string; target: string }) {
  const percent = Math.min(100, Math.round((Number(value) / Number(target)) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500">
          {naira(value)} of {naira(target)}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-primary-600" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular-nums text-sm font-medium text-slate-900">{typeof value === "number" ? value.toLocaleString("en-NG") : value}</dd>
    </div>
  );
}

export function ClinicReport({ slug }: { slug: string }) {
  const [report, setReport] = useState<PublicClinicReport | null>(null);

  useEffect(() => {
    apiFetchJson<PublicClinicReport>(`/clinic-gifts/clinics/${encodeURIComponent(slug)}/report`)
      .then(setReport)
      // Not established yet, or unavailable: the giving card already says so.
      .catch(() => setReport(null));
  }, [slug]);

  if (!report) return null;
  const { targets, endowment, running, zakah } = report;

  return (
    <div className="mt-10 space-y-4">
      <h2 className="font-display text-xl font-medium tracking-tight text-slate-900">How it&apos;s going</h2>

      {(targets.endowment || targets.runningMonthly) && (
        <Card className="space-y-4">
          {targets.endowment && <Progress label="Endowed so far" value={endowment.endowed} target={targets.endowment} />}
          {targets.runningMonthly && <Progress label="Running fund this month" value={running.receivedThisMonth} target={targets.runningMonthly} />}
        </Card>
      )}

      <Card>
        <p className="text-sm font-medium text-slate-900">The endowment</p>
        <p className="text-xs text-slate-500">Kept for ever; only its income is spent.</p>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Figure label="Endowed" value={naira(endowment.endowed)} />
          <Figure label="Premises and equipment" value={naira(endowment.premisesAndEquipment)} />
          <Figure label="Invested" value={naira(endowment.invested)} />
          <Figure label="Cash" value={naira(endowment.cash)} />
        </dl>
      </Card>

      <Card>
        <p className="text-sm font-medium text-slate-900">The running fund</p>
        <p className="text-xs text-slate-500">
          Gifts and the endowment&apos;s income, spent on subsidised visits and running costs. A share of the income is set aside to replace worn-out
          equipment.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Figure label="Gifts received" value={naira(running.gifts)} />
          <Figure label="Endowment income" value={naira(running.endowmentIncome)} />
          <Figure label="Spent on subsidised visits" value={naira(running.subsidisedVisits)} />
          <Figure label="Running costs" value={naira(running.runningCosts)} />
          <Figure label="Set aside to replace equipment" value={naira(running.equipmentReserve)} />
          <Figure label="Spent replacing equipment" value={naira(running.spentOnReplacements)} />
        </dl>
      </Card>

      <Card>
        <p className="text-sm font-medium text-slate-900">Zakah</p>
        <p className="text-xs text-slate-500">Never part of the waqf. It pays only the bills of patients assessed as poor or needy.</p>
        <dl className="mt-3">
          <Figure label="Paid for patients' bills" value={naira(zakah.paidForPatients)} />
        </dl>
      </Card>

      {report.months.length > 0 && (
        <Card>
          <p className="text-sm font-medium text-slate-900">Month by month</p>
          <p className="text-xs text-slate-500">The operator&apos;s figures, checked and published by Birr, and the visits Birr subsidised.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {report.months.map((m) => (
              <li key={m.period} className="py-3">
                <p className="text-sm font-medium text-slate-800">{monthName(m.period)}</p>
                {m.figures && (
                  <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Figure label="Visits" value={m.figures.visits} />
                    <Figure label="Children immunised" value={m.figures.childrenImmunised} />
                    <Figure label="Tests run" value={m.figures.testsRun} />
                    <Figure label="Referrals" value={m.figures.referrals} />
                  </dl>
                )}
                {m.subsidised && (
                  <div className="mt-2 text-sm text-slate-600">
                    <p>
                      {m.subsidised.patients.toLocaleString("en-NG")} patients subsidised. Approved: {naira(m.subsidised.fromRunningFund)} from the running
                      fund, {naira(m.subsidised.fromZakah)} from zakah.
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{m.subsidised.byService.map((s) => `${s.service} ${s.visits.toLocaleString("en-NG")}`).join(" · ")}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
