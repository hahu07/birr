"use client";

// Step 4 — the final onboarding step. The founder's real, structured
// e-signature appointing Birr as Mutawalli (trustee) over the Waqf Fund
// just established and funded. Deliberately doesn't pre-fill the typed
// name field — actively typing it, not just confirming a pre-filled
// value, is the point of a typed-name signature.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import type { Waqf } from "../../../lib/types";
import { Alert, Button, Card, Input, Skeleton } from "@birr/ui";

export default function OnboardingDeedPage() {
  const [waqf, setWaqf] = useState<Waqf | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [typedLegalName, setTypedLegalName] = useState("");
  const [affirmed, setAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Waqf[]>("/waqfs")
      .then((waqfs) => {
        if (!cancelled) setWaqf(waqfs.find((w) => w.status === "active") ?? null);
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
    if (!waqf) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/waqf-deeds", {
        method: "POST",
        body: JSON.stringify({ waqfId: waqf.id, typedLegalName, affirmed }),
      });
      window.location.reload();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const canSubmit = typedLegalName.trim().length > 0 && affirmed && !submitting;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign the waqf deed</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        The last step — formally appointing Birr as Mutawalli (trustee) over your Waqf Fund.
      </p>

      {loadError && (
        <Alert tone="danger" title="Couldn't load your waqf fund" className="mt-6">
          {loadError}
        </Alert>
      )}
      {!loadError && !waqf && <Skeleton className="mt-6 h-40 w-full" />}

      {waqf && (
        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          {submitError && (
            <Alert tone="danger" title="Couldn't sign the deed">
              {submitError}
            </Alert>
          )}

          <Card>
            <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">Deed of waqf</p>
            <p className="text-sm text-slate-700">
              This deed records the establishment of <span className="font-medium">{waqf.name}</span>, under{" "}
              <span className="font-medium">{waqf.foundation.name}</span>. By signing below, you irrevocably
              dedicate the assets contributed as waqf (Islamic endowment), and confirm that Birr is appointed as
              Mutawalli (trustee) over the fund, to administer it in accordance with applicable Shariah governance
              standards and {waqf.jurisdiction}&apos;s regulatory requirements. This appointment takes effect upon
              signature.
            </p>
          </Card>

          <Card>
            <div className="space-y-4">
              <div>
                <label htmlFor="typedLegalName" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Type your full legal name to sign
                </label>
                <Input
                  id="typedLegalName"
                  value={typedLegalName}
                  onChange={(e) => setTypedLegalName(e.target.value)}
                  placeholder="Full legal name, as registered on this account"
                  required
                />
              </div>
              <label className="flex items-start gap-2.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={affirmed}
                  onChange={(e) => setAffirmed(e.target.checked)}
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
