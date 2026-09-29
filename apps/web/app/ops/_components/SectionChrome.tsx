"use client";

// Shared header + loading-skeleton chrome for any page built out of
// "heading + toggleable add form + table" sections — the Waqf Fund
// detail page's five sections (Causes, Assets, Beneficiaries,
// Investments, Distributions) and the Jurisdictions page's two
// (Trustee Licenses, Compliance Policy Sets) all follow this shape, so
// this is the one place it lives. Under app/_components/ (not a route
// segment — the leading underscore excludes it from Next's router) so
// it's reachable from any page, not nested under one route's folder.
import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * The fetch/error/reload boilerplate repeated near-verbatim across
 * every Ops Console *Section.tsx component (found in a codebase
 * audit) — a GET on mount/dep-change, `null` while loading, a caught
 * error surfaced as a string, and a stable `reload` a caller (a form's
 * onCreated, a row action's onChanged) can call to refetch. Also closes
 * a latent race a couple of hand-written versions of this already
 * guarded against and the rest didn't: if `deps` changes again before
 * the in-flight request resolves, a stale response arriving after a
 * fresher one is now dropped rather than overwriting it.
 *
 * Deliberately doesn't own rendering (Alert/Skeleton/EmptyState/Table
 * branches) — those differ too much page to page (column counts, extra
 * summary rows, per-page empty copy) to force through one shape; each
 * section still writes its own `{error && <Alert>...}` etc., just
 * against this hook's `data`/`error` instead of hand-rolled state.
 *
 * `data` is never reset to `null` on a refetch, whether that's the
 * effect firing again because `deps` changed or a caller invoking the
 * returned `reload()` directly (a form's onCreated, a row action's
 * onChanged) — the previous data stays on screen until the new
 * response replaces it, rather than flashing back to a loading
 * skeleton. A section that specifically wants "switching resource
 * clears the table" (e.g. a dropdown picking a different one) can
 * still do that itself with one extra line, same as before this hook
 * existed.
 */
export function useLoadedResource<T>(fetcher: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // Latest fetcher kept in a ref so `reload` can stay stable — React's
  // compiler rejects a non-literal dependency list on useCallback.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const reload = useCallback(() => {
    const thisRequest = ++requestId.current;
    fetcherRef
      .current()
      .then((result) => {
        if (requestId.current === thisRequest) setData(result);
      })
      .catch((err: unknown) => {
        if (requestId.current === thisRequest) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's own dependency list, not statically visible here
  }, deps);

  return { data, error, reload };
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
