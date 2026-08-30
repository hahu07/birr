import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * Composable data-table primitives — the workhorse for ops-console list
 * views (caseload, approval queue, and future governed-entity tables).
 * Deliberately unopinionated about columns/rows so callers can mix in
 * Badge, Button, etc. per cell.
 */
export type TableTone = "primary" | "violet";

const wrapperToneClasses: Record<TableTone, string> = {
  primary: "border-primary-100",
  violet: "border-violet-100",
};

export function Table({
  tone = "primary",
  className = "",
  ...props
}: HTMLAttributes<HTMLTableElement> & { tone?: TableTone }) {
  return (
    <div className={`overflow-hidden rounded-lg border ${wrapperToneClasses[tone]} bg-white shadow-sm`}>
      <div className="overflow-x-auto">
        {/* table-auto (the default), not table-fixed: tried table-fixed to
            stop a colSpan error row from reflowing other columns (a
            low-severity note from design evaluation), but fixed layout
            sizes every column from the header row alone — for the
            approval queue's "Actions" column, that's narrower than the
            two buttons its body cells actually hold, so it clipped the
            Reject button, reintroducing a worse bug than the one it
            fixed. Verified live in-browser both ways before reverting. */}
        <table className={`w-full border-collapse text-sm ${className}`} {...props} />
      </div>
    </div>
  );
}

// `tone` here (not an appended className override) for the same reason
// Card.tsx now takes one: there's no tailwind-merge in this repo, so a
// caller passing `className="bg-violet-100"` to override a component
// that already hardcodes `bg-primary-50` would lose by CSS source
// order, not render violet. A lookup map guarantees only one
// background/text utility per property is ever emitted.
const headToneClasses: Record<TableTone, string> = {
  // Full-strength, not a 50/70%-opacity wash — the single most-repeated
  // surface in every dense list view, so this is where "the content
  // canvas is still black-and-white" gets fixed or doesn't.
  primary: "border-b border-primary-200 bg-primary-100",
  // AI Agents' registry table — the one place in the content canvas
  // where violet (AI-agent semantics) gets real surface presence, not
  // just a 40px header badge.
  violet: "border-b border-violet-200 bg-violet-100",
};

const headerCellToneClasses: Record<TableTone, string> = {
  primary: "text-primary-900",
  violet: "text-violet-900",
};

const rowToneClasses: Record<TableTone, string> = {
  primary: "hover:bg-primary-100/60",
  violet: "hover:bg-violet-100/60",
};

export function TableHead({
  tone = "primary",
  className = "",
  ...props
}: HTMLAttributes<HTMLTableSectionElement> & { tone?: TableTone }) {
  return <thead className={`${headToneClasses[tone]} ${className}`} {...props} />;
}

export function TableBody({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={`divide-y divide-slate-100 ${className}`} {...props} />;
}

export function TableRow({
  tone = "primary",
  className = "",
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { tone?: TableTone }) {
  return <tr className={`transition-colors ${rowToneClasses[tone]} ${className}`} {...props} />;
}

export function TableHeaderCell({
  tone = "primary",
  className = "",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { tone?: TableTone }) {
  return (
    <th
      scope="col"
      className={`px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider ${headerCellToneClasses[tone]} ${className}`}
      {...props}
    />
  );
}

export function TableCell({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-5 py-3 align-middle text-slate-700 ${className}`} {...props} />;
}
