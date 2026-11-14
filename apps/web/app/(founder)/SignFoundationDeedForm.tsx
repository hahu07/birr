"use client";

// Shared deed-signing form — Foundation-level (see FoundationDeed's own
// schema comment: one deed covers this Foundation and every Waqf Fund
// under it, present and future). Used both by onboarding's step 4 (the
// founder's first Foundation, signed as part of the wizard) and by
// foundations/[id]/deed/page.tsx (any Foundation, including one
// established later). 2026-09-14 audit fix: the onboarding wizard used
// to be the ONLY place a deed could ever be signed, hardcoded to
// foundations[0] — a Waqf Fund established under any 2nd+ Foundation
// could never have its deed signed through the UI at all, even though
// the backend (POST /foundation-deeds) already accepts any foundationId.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../lib/api";
import { useFounderSession } from "../../lib/founder-session";
import { humanize } from "../../lib/format";
import type { Foundation, Waqf } from "../../lib/types";
import { Alert, Button, IconCheckCircle, IconFileText, IconShieldCheck, Skeleton } from "@birr/ui";

/** Same comparison the backend makes (FoundationDeedsService: trimmed, case-insensitive). */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function SignFoundationDeedForm({ foundation, onSigned }: { foundation: Foundation; onSigned: () => void }) {
  const { user } = useFounderSession();
  const [activeWaqfs, setActiveWaqfs] = useState<Waqf[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [typedLegalName, setTypedLegalName] = useState("");
  const [affirmed, setAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No GET /foundations/:id/waqfs endpoint exists — /waqfs already
    // returns every waqf this founder session can see (across every
    // Foundation they're on), so filtering to this one Foundation
    // client-side is simpler than adding a new scoped route for it.
    apiFetchJson<Waqf[]>("/waqfs")
      .then((waqfs) => {
        if (!cancelled) setActiveWaqfs(waqfs.filter((w) => w.foundationId === foundation.id && w.status === "active"));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [foundation.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/foundation-deeds", {
        method: "POST",
        body: JSON.stringify({ foundationId: foundation.id, typedLegalName, affirmed }),
      });
      onSigned();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const hasActiveWaqf = Boolean(activeWaqfs?.length);
  const canSubmit = hasActiveWaqf && typedLegalName.trim().length > 0 && affirmed && !submitting;

  if (loadError) {
    return (
      <Alert tone="danger" title="Couldn't load this Foundation's Waqf Funds">
        {loadError}
      </Alert>
    );
  }
  if (activeWaqfs === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  const nameMatches = Boolean(user && typedLegalName.trim() && sameName(typedLegalName, user.fullName));
  const today = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date());

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {submitError && (
        <Alert tone="danger" title="Couldn't sign the deed">
          {submitError}
        </Alert>
      )}

      {!hasActiveWaqf && (
        <Alert tone="warning" title="Fund your first Waqf Fund before signing">
          You need at least one active (funded) Waqf Fund under {foundation.name} before Birr can be formally
          appointed as Mutawalli (trustee).
        </Alert>
      )}

      <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-primary-700 via-primary-500 to-accent-500" />
        <div className="px-6 py-8 sm:px-10">
          <div className="text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700 ring-1 ring-primary-100">
              <IconFileText className="h-5 w-5" />
            </span>
            <h2 className="font-display mt-4 text-2xl font-medium tracking-tight text-slate-900">Deed of Waqf</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{foundation.name}</p>
          </div>

          <dl className="mt-8 grid gap-4 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-500">Foundation</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{foundation.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Mutawalli (trustee)</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">Birr</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Signed by</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{user?.fullName ?? "—"}</dd>
            </div>
          </dl>

          <p className="mt-8 text-[15px] leading-7 text-slate-700">
            This deed records the establishment of <span className="font-medium">{foundation.name}</span> and
            appoints Birr as Mutawalli (trustee) over every Waqf Fund established under it — including funds you
            establish in the future. By signing below, you irrevocably dedicate the assets contributed to each such
            Waqf Fund as waqf (Islamic endowment), to be administered in accordance with applicable Shariah
            governance standards and each fund&apos;s own jurisdiction&apos;s regulatory requirements. This
            appointment takes effect upon signature.
          </p>

          {hasActiveWaqf && (
            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Waqf Funds covered as of today</p>
              <ul className="mt-3 space-y-2">
                {activeWaqfs!.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm">
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                      <IconCheckCircle className="h-4 w-4 shrink-0 text-primary-600" />
                      {w.name}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {humanize(w.type)} · {w.jurisdiction}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Any Waqf Fund you establish under this Foundation later is covered too.</p>
            </div>
          )}

          <div className="mt-10 grid gap-6 border-t border-slate-200 pt-8 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label htmlFor="typedLegalName" className="block text-sm font-medium text-slate-800">
                Type your full legal name to sign
              </label>
              {/* The input is the signature line itself: what's typed appears in a signature style. */}
              <input
                id="typedLegalName"
                value={typedLegalName}
                onChange={(e) => setTypedLegalName(e.target.value)}
                placeholder={user?.fullName ?? "Your full legal name"}
                required
                disabled={!hasActiveWaqf}
                autoComplete="name"
                className="font-display mt-3 w-full border-0 border-b-2 border-slate-300 bg-transparent px-0 pb-1 text-3xl italic text-slate-900 placeholder:text-slate-300 focus:border-primary-600 focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
              />
              <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${nameMatches ? "font-medium text-primary-700" : "text-slate-500"}`}>
                {nameMatches ? (
                  <>
                    <IconCheckCircle className="h-3.5 w-3.5" /> Matches your registered name
                  </>
                ) : user ? (
                  <>
                    Must match your registered name: <span className="font-medium text-slate-700">{user.fullName}</span>
                  </>
                ) : (
                  "Must match your account's registered name."
                )}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-medium text-slate-500">Date</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">{today}</p>
            </div>
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 text-sm text-slate-700 transition-colors hover:border-slate-300 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50/70">
            <input
              type="checkbox"
              checked={affirmed}
              onChange={(e) => setAffirmed(e.target.checked)}
              disabled={!hasActiveWaqf}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700"
            />
            <span>
              I have read and agree to the deed above, and I am authorized to sign on behalf of this Founder
              account.
            </span>
          </label>
        </div>
      </article>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <IconShieldCheck className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-sm text-slate-600">
                {canSubmit ? "Ready to sign." : "Type your name and tick the box to sign."}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">Signing appoints Birr as Mutawalli (trustee). It takes effect immediately.</p>
            </div>
          </div>
          <Button type="submit" variant="primary" disabled={!canSubmit} className="shrink-0 rounded-lg px-5 py-2.5 font-semibold">
            {submitting ? "Signing…" : "Sign deed"}
          </Button>
        </div>
      </div>
    </form>
  );
}
