"use client";

// The signed Foundation deed — the actual legal instrument appointing
// Birr as Mutawalli (trustee) over this Foundation and every Waqf Fund
// established under it, viewable any time after signing. Fetched via
// GET /foundations/:id, already founder-scoped (see
// FoundationsService.findByIdForFounder) — no separate deed endpoint
// needed here.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../../lib/api";
import { formatDate } from "../../../../../lib/format";
import { useMarkNotificationsReadForEntity } from "../../../../../lib/notifications";
import type { Foundation } from "../../../../../lib/types";
import { Alert, Button, Skeleton } from "@birr/ui";
import { DeedDocument } from "../../../DeedDocument";

export default function FoundationDeedPage() {
  const params = useParams<{ id: string }>();
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Foundation>(`/foundations/${params.id}`)
      .then((data) => {
        if (!cancelled) setFoundation(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — covers foundation_deed.signed,
  // which links here.
  useMarkNotificationsReadForEntity("FoundationDeed", foundation?.foundationDeed?.id);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/foundations/${params.id}`}
          className="text-sm font-medium text-primary-700 hover:text-primary-800"
        >
          ← {foundation?.name ?? "Foundation"}
        </Link>
        {foundation?.foundationDeed && (
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't load this deed" className="mt-6">
          {error}
        </Alert>
      )}

      {!error && !foundation && <Skeleton className="mt-6 h-96 w-full" />}

      {!error && foundation && !foundation.foundationDeed && (
        <Alert tone="warning" title="No deed signed yet" className="mt-6">
          {foundation.name} doesn&apos;t have a signed deed on file yet.
        </Alert>
      )}

      {!error && foundation?.foundationDeed && (
        <div className="mt-6">
          <DeedDocument
            eyebrow="Deed of Waqf"
            title={foundation.name}
            deedText={foundation.foundationDeed.deedText}
            signedBy={foundation.foundationDeed.typedLegalName}
            signedAt={formatDate(foundation.foundationDeed.signedAt)}
          />
        </div>
      )}
    </div>
  );
}
