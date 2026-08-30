"use client";

// Step 4 — the final onboarding step. The founder's real, structured
// e-signature appointing Birr as Mutawalli (trustee) over the Foundation
// and every Waqf Fund established under it, now or in the future — not
// just the specific fund that happened to get funded first. Deed-
// signing is Foundation-level (see FoundationDeed's own schema
// comment), so nothing about the "+ Add Waqf Fund" flow for a 2nd+ fund
// needs a deed step of its own; this one covers it automatically.
// Deliberately doesn't pre-fill the typed name field — actively typing
// it, not just confirming a pre-filled value, is the point of a
// typed-name signature.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { useFounderSession } from "../../../../lib/founder-session";
import type { Foundation, Waqf } from "../../../../lib/types";
import { Alert, Button, Card, Input, Skeleton } from "@birr/ui";

export default function OnboardingDeedPage() {
  const { user } = useFounderSession();
  const [foundation, setFoundation] = useState<Foundation | null>(null);
  const [activeWaqfs, setActiveWaqfs] = useState<Waqf[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [typedLegalName, setTypedLegalName] = useState("");
  const [affirmed, setAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetchJson<Foundation[]>("/foundations"), apiFetchJson<Waqf[]>("/waqfs")])
      .then(([foundations, waqfs]) => {
        if (cancelled) return;
        // Exactly one Foundation exists by this point in the wizard.
        setFoundation(foundations[0] ?? null);
        setActiveWaqfs(waqfs.filter((w) => w.status === "active"));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!foundation) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/foundation-deeds", {
        method: "POST",
        body: JSON.stringify({ foundationId: foundation.id, typedLegalName, affirmed }),
      });
      window.location.reload();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const hasActiveWaqf = Boolean(activeWaqfs?.length);
  const canSubmit = hasActiveWaqf && typedLegalName.trim().length > 0 && affirmed && !submitting;

  return (
    <div>
      <Link
        href="/onboarding/waqf-fund"
        className="mb-3 inline-flex items-center text-sm font-medium text-primary-700 hover:text-primary-800"
      >
        ← Back
      </Link>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign the waqf deed</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        The last step — formally appointing Birr as Mutawalli (trustee) over your Foundation and every Waqf Fund
        established under it.
      </p>

      {loadError && (
        <Alert tone="danger" title="Couldn't load your foundation" className="mt-6">
          {loadError}
        </Alert>
      )}
      {!loadError && !foundation && <Skeleton className="mt-6 h-40 w-full" />}

      {foundation && (
        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          {submitError && (
            <Alert tone="danger" title="Couldn't sign the deed">
              {submitError}
            </Alert>
          )}

          {!hasActiveWaqf && (
            <Alert tone="warning" title="Fund your first Waqf Fund before signing">
              You need at least one active (funded) Waqf Fund under {foundation.name} before Birr can be formally
              appointed as Mutawalli.
            </Alert>
          )}

          <Card>
            <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">Deed of waqf</p>
            <p className="text-sm text-slate-700">
              This deed records the establishment of <span className="font-medium">{foundation.name}</span>{" "}
              and appoints Birr as Mutawalli (trustee) over every Waqf Fund established under it — including funds
              you establish in the future. By signing below, you irrevocably dedicate the assets contributed to
              each such Waqf Fund as waqf (Islamic endowment), to be administered in accordance with applicable
              Shariah governance standards and each fund&apos;s own jurisdiction&apos;s regulatory requirements.
              This appointment takes effect upon signature.
            </p>
            {hasActiveWaqf && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
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
                <span>I have read and agree to the deed above, and I am authorized to sign on behalf of this Founder account.</span>
              </label>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {submitting ? "Signing…" : "Sign deed"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
