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
import type { Foundation, Waqf } from "../../lib/types";
import { Alert, Button, Card, Input, Skeleton } from "@birr/ui";

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

      <Card>
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">Deed of waqf</p>
        <p className="text-sm text-slate-700">
          This deed records the establishment of <span className="font-medium">{foundation.name}</span> and
          appoints Birr as Mutawalli (trustee) over every Waqf Fund established under it — including funds you
          establish in the future. By signing below, you irrevocably dedicate the assets contributed to each such
          Waqf Fund as waqf (Islamic endowment), to be administered in accordance with applicable Shariah
          governance standards and each fund&apos;s own jurisdiction&apos;s regulatory requirements. This
          appointment takes effect upon signature.
        </p>
        {hasActiveWaqf && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              Waqf Fund(s) covered as of today
            </p>
            <ul className="space-y-1 text-sm text-slate-700">
              {activeWaqfs!.map((w) => (
                <li key={w.id}>
                  {w.name} — {w.jurisdiction}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <div className="space-y-4">
          <div>
            <label htmlFor="typedLegalName" className="mb-1.5 block text-sm font-medium text-slate-700">
              Type your full legal name to sign
            </label>
            {user && (
              <p className="mb-1.5 text-xs text-slate-500">
                Must match your account&apos;s registered name exactly:{" "}
                <span className="font-medium text-slate-700">{user.fullName}</span>
              </p>
            )}
            <Input
              id="typedLegalName"
              value={typedLegalName}
              onChange={(e) => setTypedLegalName(e.target.value)}
              placeholder="Full legal name, as registered on this account"
              required
              disabled={!hasActiveWaqf}
            />
          </div>
          <label className="flex items-start gap-2.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={affirmed}
              onChange={(e) => setAffirmed(e.target.checked)}
              disabled={!hasActiveWaqf}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span>
              I have read and agree to the deed above, and I am authorized to sign on behalf of this Founder
              account.
            </span>
          </label>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? "Signing…" : "Sign deed"}
        </Button>
      </div>
    </form>
  );
}
