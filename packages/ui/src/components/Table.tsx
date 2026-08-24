import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * Composable data-table primitives — the workhorse for ops-console list
 * views (caseload, approval queue, and future governed-entity tables).
 * Deliberately unopinionated about columns/rows so callers can mix in
 * Badge, Button, etc. per cell.
 */
export function Table({ className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
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

export function TableHead({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`border-b border-slate-200 bg-slate-50/60 ${className}`} {...props} />;
}

export function TableBody({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={`divide-y divide-slate-100 ${className}`} {...props} />;
}

export function TableRow({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`transition-colors hover:bg-slate-50/80 ${className}`} {...props} />;
}

export function TableHeaderCell({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${className}`}
      {...props}
    />
  );
}

export function TableCell({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-5 py-3 align-middle text-slate-700 ${className}`} {...props} />;
}
