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
  not_applicable: "text-slate-400",
  not_available: "text-slate-400",
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
            <li key={row.key} className="flex items-center gap-3 px-4 py-2.5">
              <Icon className={`h-[18px] w-[18px] shrink-0 ${STATUS_ICON_TONE[row.status]}`} />
              <span className={`flex-1 text-sm font-medium ${STATUS_TEXT_TONE[row.status]}`}>{row.label}</span>
              {row.detail && <span className="shrink-0 text-xs text-slate-400">{row.detail}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
