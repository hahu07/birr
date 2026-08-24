import { HTMLAttributes, ReactNode } from "react";

export interface DetailItem {
  label: string;
  value: ReactNode;
}

export interface DetailGridProps extends HTMLAttributes<HTMLDivElement> {
  items: DetailItem[];
  /** Desktop column count. Defaults to 3 (e.g. type / jurisdiction / date). */
  columns?: 2 | 3;
}

const columnClasses: Record<NonNullable<DetailGridProps["columns"]>, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
};

/**
 * Compact label/value grid for calm summary layouts (Founder Portal-style
 * account overviews, future report pages) — an alternative to Table's
 * dense rows-and-columns when content reads better as a handful of
 * labeled facts per card than as a queue of records to work through.
 */
export function DetailGrid({ items, columns = 3, className = "", ...props }: DetailGridProps) {
  return (
    <div className={`grid grid-cols-2 gap-x-6 gap-y-4 ${columnClasses[columns]} ${className}`} {...props}>
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{item.label}</p>
          <p className="mt-1 text-sm font-medium text-slate-800">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
