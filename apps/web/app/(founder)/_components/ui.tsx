// Founder Portal building blocks for the 2026-10 redesign — page header,
// panels, progress bar, fund row and link-button styles shared by every
// redesigned page, so they read as one product rather than each page
// re-deciding spacing, radii and type. `_components` is a private folder
// (excluded from routing). Deliberately local to app/(founder), not
// @birr/ui: the Ops Console's own redesign hasn't happened yet, and these
// carry Founder-specific type (font-display) and copy.
import Link from "next/link";
import { ReactNode, useId } from "react";
import { formatMoney, humanize } from "../../../lib/format";
import { STATUS_BADGE_BG, STATUS_ICON, STATUS_TONE } from "../../../lib/portfolio";
import type { Waqf } from "../../../lib/types";
import { Badge, IconArrowRight, IconChevronRight } from "@birr/ui";

export const TYPE_LABEL: Record<Waqf["type"], string> = { investment: "Investment", asset: "Asset", project: "Project" };

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600";

/** Class strings for a <Link> styled as a button (a <button> nested in an <a> is invalid HTML). */
export const linkButton = {
  primary: `inline-flex items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-900/20 transition-colors hover:bg-primary-800 ${focusRing}`,
  secondary: `inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 ${focusRing}`,
  quiet: `inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800 ${focusRing} rounded`,
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-8">
      {back && (
        <Link href={back.href} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-primary-700">
          <IconArrowRight className="h-3.5 w-3.5 rotate-180" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">{eyebrow}</p>}
          <h1 className={`font-display text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl ${eyebrow ? "mt-2" : ""}`}>{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
      </div>
    </header>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm ${className}`}>{children}</section>;
}

export function PanelHeader({ title, href, linkLabel, aside }: { title: ReactNode; href?: string; linkLabel?: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <h2 className="min-w-0 text-sm font-semibold text-slate-900">{title}</h2>
      {aside}
      {href && (
        <Link href={href} className={linkButton.quiet}>
          {linkLabel}
          <IconArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

export function ProgressBar({
  pct,
  label,
  tone = "primary",
  className = "",
}: {
  pct: number;
  label: string;
  tone?: "primary" | "gold";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`overflow-hidden rounded-full ${tone === "gold" ? "h-2 bg-white/10" : "h-1.5 bg-slate-100"} ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${tone === "gold" ? "bg-gradient-to-r from-accent-300 to-accent-500" : "bg-primary-600"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Decorative 8-point-star lattice — a quiet nod to Islamic geometric art. */
export function GeometricPattern({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} aria-hidden="true">
      <defs>
        <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse">
          <path
            d="M28 6 34 22 50 28 34 34 28 50 22 34 6 28 22 22Z M28 14 32 24 42 28 32 32 28 42 24 32 14 28 24 24Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** One Waqf Fund as a clickable row: status, name, type/foundation, funding progress. */
export function FundRow({ waqf, showFoundation = true }: { waqf: Waqf; showFoundation?: boolean }) {
  const StatusIcon = STATUS_ICON[waqf.status];
  const raised = Number(waqf.amountRaised ?? 0);
  const target = waqf.corpusAmount ? Number(waqf.corpusAmount) : null;
  const pct = target ? (raised / target) * 100 : null;
  return (
    <Link href={`/portfolio/${waqf.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50/80">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${STATUS_BADGE_BG[waqf.status]}`}>
        <StatusIcon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        {/* Two lines on a phone rather than "Orphan Scholarship …". */}
        <span className="flex items-start gap-2 sm:items-center">
          <span className="line-clamp-2 text-sm font-semibold text-slate-900 sm:truncate">{waqf.name}</span>
          <Badge tone={STATUS_TONE[waqf.status]} className="shrink-0">
            {humanize(waqf.status)}
          </Badge>
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">
          {TYPE_LABEL[waqf.type]} fund
          {showFoundation && ` · ${waqf.foundation.name}`}
          {waqf.fundingPlan === "installment" && " · Installments"}
        </span>
        {pct !== null && waqf.corpusCurrency && (
          <span className="mt-2.5 flex items-center gap-3">
            <ProgressBar pct={pct} label={`${Math.round(pct)}% of corpus raised`} className="flex-1" />
            <span className="shrink-0 text-xs tabular-nums text-slate-600">
              <span className="font-semibold text-slate-900">{formatMoney(raised, waqf.corpusCurrency, { decimals: 0 })}</span>
              <span className="hidden sm:inline"> of {formatMoney(target!, waqf.corpusCurrency, { decimals: 0 })}</span>
            </span>
          </span>
        )}
      </span>
      <IconChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
    </Link>
  );
}
