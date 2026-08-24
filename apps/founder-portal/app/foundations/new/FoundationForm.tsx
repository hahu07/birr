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
import { apiFetchJson } from "../../../lib/api";
import type { Foundation } from "../../../lib/types";
import { Alert, Button, Card, Input } from "@birr/ui";

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
        <Card>
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-700">
                Name
              </label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="purpose" className="mb-1.5 block text-sm font-medium text-slate-700">
                Purpose
              </label>
              <textarea
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                required
                placeholder="What this Foundation exists to support — this becomes part of the dedication itself."
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="jurisdiction" className="mb-1.5 block text-sm font-medium text-slate-700">
                Jurisdiction <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <Input
                id="jurisdiction"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g. AE"
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          {cancelHref && (
            <Link href={cancelHref}>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
          )}
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {submitting ? "Creating…" : "Establish Foundation"}
          </Button>
        </div>
      </form>
    </>
  );
}
