// Header for an Ops Console detail page (Waqf Fund, Vault) — back link,
// identity, a strip of key facts, optional funding progress, and the
// page's own actions. One shape for both so a staff member reads every
// detail page the same way (2026-10 redesign). Purely presentational:
// any action passed in keeps its own governed/ungoverned semantics.
import Link from "next/link";
import { ReactNode } from "react";
import { IconArrowRight } from "@birr/ui";

export interface EntityFact {
  label: string;
  value: ReactNode;
}

export interface EntityHeading {
  title: string;
  badge?: ReactNode;
  subtitle?: ReactNode;
}

export function EntityHeader({
  back,
  icon,
  heading,
  facts,
  progress,
  actions,
}: {
  back: { href: string; label: string };
  icon: ReactNode;
  heading: EntityHeading;
  facts: EntityFact[];
  progress?: { pct: number; caption: ReactNode };
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <Link href={back.href} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-primary-700">
        <IconArrowRight className="h-3.5 w-3.5 rotate-180" />
        {back.label}
      </Link>
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            {icon}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900">{heading.title}</h1>
                {heading.badge}
              </div>
              {heading.subtitle && <div className="mt-1 text-sm text-slate-500">{heading.subtitle}</div>}
            </div>
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        {progress && <ProgressBlock pct={progress.pct} caption={progress.caption} />}
        <FactsStrip facts={facts} />
      </div>
    </header>
  );
}

function ProgressBlock({ pct, caption }: { pct: number; caption: ReactNode }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="px-5 pb-5 sm:px-6">
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}>
        <div className="h-full rounded-full bg-primary-600" style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-2 text-sm text-slate-600">{caption}</p>
    </div>
  );
}

function FactsStrip({ facts }: { facts: EntityFact[] }) {
  return (
    <dl className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/60 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      {facts.map((f) => (
        <div key={f.label} className="border-b border-r border-slate-100 px-5 py-3.5 last:border-r-0 sm:px-6">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{f.label}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-slate-900">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
