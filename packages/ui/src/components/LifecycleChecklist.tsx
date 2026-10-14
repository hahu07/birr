import { IconArchive, IconCheckCircle, IconClock } from "./icons";

export interface LifecycleChecklistRow {
  key: string;
  label: string;
  status: "complete" | "pending" | "not_applicable" | "not_available";
  detail?: string | null;
}

export interface LifecycleChecklistProps {
  rows: LifecycleChecklistRow[];
  completedCount: number;
  trackableCount: number;
}

const STATUS_ICON = {
  complete: IconCheckCircle,
  pending: IconClock,
  not_applicable: IconArchive,
  not_available: IconArchive,
} as const;

const STATUS_ICON_TONE = {
  complete: "text-primary-600",
  pending: "text-accent-500",
  not_applicable: "text-slate-300",
  not_available: "text-slate-300",
} as const;

const STATUS_TEXT_TONE = {
  complete: "text-slate-900",
  pending: "text-slate-700",
  not_applicable: "text-slate-500",
  not_available: "text-slate-500",
} as const;

/**
 * Purely presentational, no fetching — read-only on both dashboards (no
 * write path exists for this at all, unlike MessageThread), so one
 * shared component backs both dashboards' thin wrapper files.
 */
export function LifecycleChecklist({ rows, completedCount, trackableCount }: LifecycleChecklistProps) {
  return (
    <div>
      <p className="mb-3 text-xs font-medium text-slate-500">
        {completedCount} of {trackableCount} trackable stages complete
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((row) => {
          const Icon = STATUS_ICON[row.status];
          return (
            // flex-wrap, with the detail dropping to its own indented line
            // below sm — a long detail ("Guaranteed by the immutable audit
            // trail") ran past the right edge of a phone screen as a
            // shrink-0 span beside the label.
            <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
              <Icon className={`h-[18px] w-[18px] shrink-0 ${STATUS_ICON_TONE[row.status]}`} />
              <span className={`min-w-0 flex-1 text-sm font-medium ${STATUS_TEXT_TONE[row.status]}`}>{row.label}</span>
              {row.detail && (
                <span className="basis-full pl-[30px] text-xs text-slate-500 sm:basis-auto sm:shrink-0 sm:pl-0">{row.detail}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
