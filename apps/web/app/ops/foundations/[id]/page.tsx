"use client";

// Foundation detail — new page (this Foundation previously had no
// detail route on the Ops side, only the /ops/foundations list). Its
// own job is Foundation-level context (the Waqf Funds under it, each
// linking out to its own already-existing /ops/waqfs/[id] page, which
// is where staff do the real work) plus the new Messages section —
// Founder <-> Birr staff communication is scoped per Foundation, not
// per Waqf Fund (a deliberate choice, see MessagesSection's own
// comment), so this is its natural home on the Ops side, mirroring the
// Founder Portal's own /foundations/[id] page.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import type { Foundation, Waqf } from "../../../../lib/ops-types";
import { Alert, Badge, IconLandmark, Skeleton } from "@birr/ui";
import { MessagesSection } from "./MessagesSection";

export default function OpsFoundationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([apiFetchJson<Foundation>(`/foundations/${id}`), apiFetchJson<Waqf[]>("/waqfs")])
      .then(([foundationData, waqfsData]) => {
        setFoundation(foundationData);
        setWaqfs(waqfsData.filter((w) => w.foundationId === id));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this foundation">
        {error}
      </Alert>
    );
  }

  if (!foundation) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
    );
  }

  return (
    <div>
      <header className="mb-8">
        <Link href="/ops/foundations" className="text-sm text-slate-500 hover:text-primary-700">
          ← Foundations
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
            <IconLandmark className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{foundation.name}</h1>
            {(foundation.purpose || foundation.jurisdiction) && (
              <p className="mt-0.5 text-sm text-slate-500">
                {[foundation.purpose, foundation.jurisdiction].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="mb-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          {waqfs?.length ?? 0} {waqfs?.length === 1 ? "waqf fund" : "waqf funds"}
        </p>
        <div className="space-y-1.5">
          {(waqfs ?? []).map((w) => (
            <Link
              key={w.id}
              href={`/ops/waqfs/${w.id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50"
            >
              <p className="text-sm font-medium text-slate-900">{w.name}</p>
              <Badge tone={w.status === "active" ? "success" : "neutral"}>{w.status}</Badge>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-8 border-t border-slate-100 pt-8">
        <MessagesSection foundationId={id} />
      </div>
    </div>
  );
}
