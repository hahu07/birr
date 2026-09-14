"use client";

// Update, 2026-09-14 — deed-signing moved to the Foundation level on
// 2026-08-27 (see FoundationDeed's own schema comment): one deed covers
// a Foundation and every Waqf Fund under it, present and future. This
// route used to render waqf.waqfDeed directly, which is null for every
// current waqf (nothing writes a WaqfDeed anymore — see WaqfDeed's own
// schema comment) — so it unconditionally showed "no deed on file" even
// when the Foundation's own deed, which actually covers this fund, was
// signed. portfolio/[id]/page.tsx was already fixed to link to the
// correct /foundations/[id]/deed page instead; this route stays live
// (an old bookmark, a stale link) and just forwards there now rather
// than showing the wrong answer if hit directly.
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetchJson } from "../../../../../lib/api";
import type { Waqf } from "../../../../../lib/types";
import { Alert, Skeleton } from "@birr/ui";

export default function WaqfDeedRedirectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Waqf>(`/waqfs/${params.id}`)
      .then((waqf) => {
        if (cancelled) return;
        router.replace(`/foundations/${waqf.foundationId}/deed`);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [params.id, router]);

  return (
    <div className="mx-auto max-w-3xl">
      {error ? (
        <Alert tone="danger" title="Couldn't load this deed" className="mt-6">
          {error}
        </Alert>
      ) : (
        <Skeleton className="mt-6 h-96 w-full" />
      )}
    </div>
  );
}
