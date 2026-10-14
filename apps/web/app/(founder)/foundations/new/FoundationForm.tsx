"use client";

// Presentational form, shared by the standalone /foundations/new page
// (post-onboarding, 2nd+ Foundation) and the onboarding wizard's step 2
// (app/onboarding/foundation/page.tsx). Self-service, takes effect
// immediately — no founder picker: it's always "you," the signed-in
// founder, which the backend enforces regardless of what's sent
// (FoundationsController.create() forces founderIds to the caller's own
// id whenever x-founder-id is present).
import Link from "next/link";
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import type { Foundation } from "../../../../lib/types";
import { Alert, Button } from "@birr/ui";
import { Field, FormSection, inputClass } from "../../_components/form";

export function FoundationForm({
  onSuccess,
  cancelHref,
}: {
  onSuccess: (foundation: Foundation) => void;
  cancelHref?: string;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const foundation = await apiFetchJson<Foundation>("/foundations", {
        method: "POST",
        body: JSON.stringify({
          name,
          purpose,
          jurisdiction: jurisdiction || undefined,
          founderIds: [], // ignored by the backend when x-founder-id is present — it always forces [you]
        }),
      });
      onSuccess(foundation);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim().length > 0 && purpose.trim().length > 0 && !submitting;

  return (
    <>
      {submitError && (
        <Alert tone="danger" title="Couldn't create the foundation" className="mb-6">
          {submitError}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <FormSection title="Foundation details" description="The umbrella your Waqf Funds sit under — you can add funds to it right away.">
          <div className="space-y-5">
            <Field label="Name" htmlFor="name">
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder='e.g. "Bello Family Foundation"' className={inputClass} />
            </Field>
            <Field label="Purpose" htmlFor="purpose" hint="This becomes part of the dedication itself.">
              <textarea
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                required
                placeholder="What this Foundation exists to support."
                className={inputClass}
              />
            </Field>
            <Field label="Jurisdiction" optional htmlFor="jurisdiction" hint="As a 2-letter country code — e.g. NG for Nigeria.">
              <input
                id="jurisdiction"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g. NG"
                className={`${inputClass} sm:max-w-[10rem]`}
              />
            </Field>
          </div>
        </FormSection>

        <div className="flex justify-end gap-2.5">
          {cancelHref && (
            <Link href={cancelHref} className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Cancel
            </Link>
          )}
          <Button type="submit" variant="primary" disabled={!canSubmit} className="rounded-lg px-5 py-2.5 font-semibold">
            {submitting ? "Creating…" : "Establish Foundation"}
          </Button>
        </div>
      </form>
    </>
  );
}
