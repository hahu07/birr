"use client";

// Paging for the Ops Console's long client-side lists (Waqf Funds,
// Foundations, Team). Those endpoints return every row, and rendering
// all of them at once produced pages tens of thousands of pixels tall.
// The list's search still runs over the full set; this only limits how
// much of the result is drawn, the same "Load more" shape the Audit Log
// already uses for its server-side cursor.
import { useState } from "react";
import { Button } from "@birr/ui";

/**
 * The first `pageSize` items, growing by `pageSize` on each `showMore`.
 * A change of `resetKey` (normally the search text) starts again from
 * the first page, derived during render rather than reset in an effect.
 */
export function useShowMore<T>(items: T[], pageSize: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, count: pageSize });
  const count = state.key === resetKey ? state.count : pageSize;
  return {
    visible: items.slice(0, count),
    shown: Math.min(count, items.length),
    total: items.length,
    showMore: () => setState({ key: resetKey, count: count + pageSize }),
  };
}

export function ShowMoreFooter({
  shown,
  total,
  pageSize,
  noun,
  onShowMore,
}: {
  shown: number;
  total: number;
  pageSize: number;
  /** Plural, e.g. "foundations". */
  noun: string;
  onShowMore: () => void;
}) {
  if (total <= shown) return null;
  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      <Button variant="secondary" onClick={onShowMore}>
        Show {Math.min(pageSize, total - shown)} more
      </Button>
      <p className="text-xs text-slate-500">
        Showing {shown.toLocaleString("en-NG")} of {total.toLocaleString("en-NG")} {noun}
      </p>
    </div>
  );
}
