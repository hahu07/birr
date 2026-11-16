"use client";

// The signed Foundation deed — the actual legal instrument appointing
// Birr as Mutawalli (trustee) over this Foundation and every Waqf Fund
// established under it, viewable any time after signing. Fetched via
// GET /foundations/:id, already founder-scoped (see
// FoundationsService.findByIdForFounder) — no separate deed endpoint
// needed here.
//
// Update, 2026-09-14 — also where an UNSIGNED Foundation's deed gets
// signed, not just a passive "no deed yet" notice. Before this, the
// onboarding wizard was the only place a deed could ever be signed
// (hardcoded to the founder's first Foundation), so any 2nd+ Foundation
// could never have its deed signed through the UI at all — found during
// a comprehensive Founder-side review. Only the org's primary contact
// gets the actual form (SignFoundationDeedForm's own POST requires it,
// same posture as foundations/[id]/page.tsx's "Invite a co-founder"
// gate); anyone else sees a passive notice instead of a form that would
// just 403 on submit.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../../lib/api";
import { formatDate } from "../../../../../lib/format";
import { useFounderSession } from "../../../../../lib/founder-session";
import { useMarkNotificationsReadForEntity } from "../../../../../lib/notifications";
import type { Foundation, FounderMembership } from "../../../../../lib/types";
import { Alert, Button, Skeleton } from "@birr/ui";
import { DeedDocument } from "../../../DeedDocument";

// From GET /foundation-deeds/:foundationId — each co-founder's own,
// recorded agreement to this deed (CoFounderDeedConsent).
interface CoFounderConsent {
  id: string;
  founderName: string;
  kind: "adopt_signed_deed" | "authorize_signer";
  statementText: string;
  consentedAt: string;
}
import { SignFoundationDeedForm } from "../../../SignFoundationDeedForm";
import { CoFounderConsentPanel } from "./CoFounderConsentPanel";

export default function FoundationDeedPage() {
  const params = useParams<{ id: string }>();
  const { user } = useFounderSession();
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [members, setMembers] = useState<FounderMembership[] | null>(null);
  const [consents, setConsents] = useState<CoFounderConsent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<Foundation>(`/foundations/${params.id}`),
      apiFetchJson<FounderMembership[]>("/founders/me/members"),
    ])
      .then(([foundationData, membersData]) => {
        setFoundation(foundationData);
        setMembers(membersData);
        if (foundationData.foundationDeed) {
          apiFetchJson<{ coFounderConsents: CoFounderConsent[] }>(`/foundation-deeds/${params.id}`)
            .then((deed) => setConsents(deed.coFounderConsents))
            .catch(() => setConsents([]));
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const isPrimaryContact = members?.some((m) => m.user.id === user?.id && m.permissionLevel === "primary_contact");

  // Fix for the notification read-state gap (see
  // lib/notifications.ts's own comment) — covers foundation_deed.signed,
  // which links here.
  useMarkNotificationsReadForEntity("FoundationDeed", foundation?.foundationDeed?.id);

  return (
    <div className="max-w-3xl">
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

      {!error && foundation && isPrimaryContact !== undefined && (
        <div className="mt-6 print:hidden">
          <CoFounderConsentPanel key={foundation.foundationDeed?.id ?? "unsigned"} foundationId={foundation.id} isPrimaryContact={isPrimaryContact} onAgreed={load} />
        </div>
      )}

      {!error && foundation && !foundation.foundationDeed && isPrimaryContact && (
        <div className="mt-6">
          <SignFoundationDeedForm foundation={foundation} onSigned={load} />
        </div>
      )}

      {!error && foundation && !foundation.foundationDeed && isPrimaryContact === false && (
        <Alert tone="warning" title="No deed signed yet" className="mt-6">
          {foundation.name} doesn&apos;t have a signed deed on file yet. Only this Foundation&apos;s primary
          contact can sign it.
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
          {consents.length > 0 && (
            <section className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm print:shadow-none sm:p-6">
              <h2 className="text-base font-semibold text-slate-900">Co-founders&apos; agreement</h2>
              <p className="mt-0.5 text-sm text-slate-500">Each co-founder agreed to this deed, in their own name, when they joined.</p>
              <ul className="mt-4 divide-y divide-slate-100">
                {consents.map((c) => (
                  <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-semibold text-slate-900">{c.founderName}</p>
                      <p className="text-xs text-slate-500">
                        {c.kind === "adopt_signed_deed" ? "Adopted this deed" : "Authorized the signer"} · {formatDate(c.consentedAt)}
                      </p>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{c.statementText}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
