"use client";

// Shared header + loading-skeleton chrome for any page built out of
// "heading + toggleable add form + table" sections — the Waqf Fund
// detail page's five sections (Causes, Assets, Beneficiaries,
// Investments, Distributions) and the Jurisdictions page's two
// (Trustee Licenses, Compliance Policy Sets) all follow this shape, so
// this is the one place it lives. Under app/_components/ (not a route
// segment — the leading underscore excludes it from Next's router) so
// it's reachable from any page, not nested under one route's folder.
import { Button, Skeleton } from "@birr/ui";

export function SectionHeader({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  // Omit both when the viewer can't act on this section at all (e.g.
  // Jurisdictions' non-admin viewers) — cleaner than the caller
  // rendering a button that would just 403 on submit.
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function RowsSkeleton({ columns }: { columns: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-8 px-5 py-3.5">
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton key={j} className="h-4 w-28" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
