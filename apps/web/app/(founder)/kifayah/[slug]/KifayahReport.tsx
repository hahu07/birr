"use client";

// Kifayah's public report (built as the need-based waqf's in NB4): its endowment and its
// spending fund, each on its own, from GET
// /programme-gifts/programmes/need_based/:slug/report. Giving first: it
// shows what has been given and what's held, and nothing about support
// until support starts. Nothing about any giver.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatMoney } from "../../../../lib/format";
import { Card } from "@birr/ui";

interface PublicProgrammeReport {
  currency: string;
  targets: { endowment: string | null; runningMonthly: string | null };
  endowment: { endowed: string; cash: string; invested: string };
  running: { gifts: string; endowmentIncome: string; receivedThisMonth: string; held: string };
}

const naira = (amount: string) => formatMoney(amount, "NGN", { decimals: 0 });

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular-nums text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export function KifayahReport({ slug }: { slug: string }) {
  const [report, setReport] = useState<PublicProgrammeReport | null>(null);

  useEffect(() => {
    apiFetchJson<PublicProgrammeReport>(`/programme-gifts/programmes/need_based/${encodeURIComponent(slug)}/report`)
      .then(setReport)
      // Not established yet, or unavailable: the giving card already says so.
      .catch(() => setReport(null));
  }, [slug]);

  if (!report) return null;
  const { endowment, running } = report;

  return (
    <div className="mt-10 space-y-4">
      <h2 className="font-display text-xl font-medium tracking-tight text-slate-900">How it&apos;s going</h2>

      <Card>
        <p className="text-sm font-medium text-slate-900">The endowment</p>
        <p className="text-xs text-slate-500">Kept for ever; only its income is spent.</p>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <Figure label="Endowed" value={naira(endowment.endowed)} />
          <Figure label="Invested" value={naira(endowment.invested)} />
          <Figure label="Cash" value={naira(endowment.cash)} />
        </dl>
      </Card>

      <Card>
        <p className="text-sm font-medium text-slate-900">The spending fund</p>
        <p className="text-xs text-slate-500">Gifts and the endowment&apos;s income, held for support for poor households until it starts.</p>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Figure label="Gifts received" value={naira(running.gifts)} />
          <Figure label="Endowment income" value={naira(running.endowmentIncome)} />
          <Figure label="Received this month" value={naira(running.receivedThisMonth)} />
          <Figure label="Held for support" value={naira(running.held)} />
        </dl>
      </Card>
    </div>
  );
}
