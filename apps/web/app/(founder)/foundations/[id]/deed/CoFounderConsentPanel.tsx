"use client";

// A co-founder's own agreement to the Foundation's deed, for one with
// none on record: someone who joined before agreeing became part of
// joining, or was added another way. A joint deed can't be signed for
// them until they agree (owner's decision, 2026-11-16), and after
// signing this is how they adopt it. Renders nothing when nothing is
// needed (GET /foundation-deeds/:id/consent returns null).
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetchJson } from "../../../../../lib/api";
import { Alert, Button } from "@birr/ui";

interface ConsentStatement {
  kind: "adopt_signed_deed" | "authorize_signer";
  text: string;
  version: string;
  hash: string;
}

export function CoFounderConsentPanel({ foundationId, isPrimaryContact, onAgreed }: { foundationId: string; isPrimaryContact: boolean; onAgreed: () => void }) {
  const [statement, setStatement] = useState<ConsentStatement | null | undefined>(undefined);
  const [accepts, setAccepts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => apiFetchJson<ConsentStatement | null>(`/foundation-deeds/${foundationId}/consent`), [foundationId]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((s) => !cancelled && setStatement(s))
      .catch(() => !cancelled && setStatement(null));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function agree() {
    if (!statement) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/foundation-deeds/${foundationId}/consent`, { method: "POST", body: JSON.stringify({ statementHash: statement.hash }) });
      setStatement(null);
      onAgreed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      // The deed was signed while they read: show what now applies.
      if (err instanceof ApiError && err.code === "statement_changed") {
        setAccepts(false);
        load().then(setStatement).catch(() => {});
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!statement) return null;

  const signed = statement.kind === "adopt_signed_deed";
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">{signed ? "Adopt this Foundation's deed" : "Your agreement is needed"}</h2>
      <p className="mt-1 text-sm text-slate-700">
        {signed
          ? "The deed was signed for every co-founder. Birr has no record of your own agreement to it yet."
          : "Another founder will sign this Foundation's deed for every co-founder, so it can't be signed for you until you agree."}
      </p>
      <blockquote className="mt-4 rounded-xl border border-amber-200 bg-white p-4 text-sm leading-relaxed text-slate-800">{statement.text}</blockquote>
      {error && (
        <Alert tone="danger" title="Couldn't record your agreement" className="mt-4">
          {error}
        </Alert>
      )}
      {isPrimaryContact ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={accepts} onChange={(e) => setAccepts(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700" />
            <span>I accept this statement. Birr keeps a dated record of it.</span>
          </label>
          <Button disabled={!accepts || submitting} onClick={agree} className="shrink-0 rounded-lg font-semibold">
            {submitting ? "Saving…" : "Agree"}
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">Only your account&apos;s primary contact can agree to this.</p>
      )}
    </section>
  );
}
