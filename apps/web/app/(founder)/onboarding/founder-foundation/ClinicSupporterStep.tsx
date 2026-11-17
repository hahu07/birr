"use client";

// Step 2 for someone who signed up from a clinic waqf's giving page
// (owner's decision, 2026-11-17: verify, then give). They become a Founder
// without setting up a Foundation, via POST /founders/clinic-supporter,
// and go straight back to the clinic. They can set up a Foundation later.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { takeReturnTo } from "../../../../lib/return-to";
import { Alert, Button, IconArrowRight, Input, Select } from "@birr/ui";
import { CountrySelect } from "../../../../components/forms/CountrySelect";
import { humanize } from "../../../../lib/format";

const INSTITUTION_TYPES = ["islamic_bank", "university", "corporate_foundation", "ngo", "family_office", "government", "awqaf_authority", "other"] as const;

export function ClinicSupporterStep({ onSetUpFoundation }: { onSetUpFoundation: () => void }) {
  const [kind, setKind] = useState<"individual" | "institution">("individual");
  const [founderName, setFounderName] = useState("");
  const [institutionType, setInstitutionType] = useState<(typeof INSTITUTION_TYPES)[number]>("ngo");
  const [homeJurisdiction, setHomeJurisdiction] = useState("NG");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/founders/clinic-supporter", {
        method: "POST",
        body: JSON.stringify({
          founderName,
          kind,
          ...(kind === "institution" && { institutionType }),
          homeJurisdiction: homeJurisdiction || undefined,
        }),
      });
      // A full load, so the Founder session and onboarding status are read afresh.
      window.location.href = takeReturnTo() ?? "/clinic-support";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">Support the clinic as a Founder</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        Tell us who is giving. You don&apos;t need to set up a Foundation to support a clinic; you can always set one up later.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <fieldset className="flex gap-2">
          {(["individual", "institution"] as const).map((k) => (
            <label key={k} className="flex flex-1 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50/60">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} className="h-4 w-4" />
              {k === "individual" ? "Myself, as an individual" : "An institution"}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor="supporter-name" className="block text-sm font-medium text-slate-700">
            {kind === "individual" ? "Your full name" : "The institution's name"}
          </label>
          <Input id="supporter-name" required check="name" value={founderName} onChange={(e) => setFounderName(e.target.value)} />
        </div>
        {kind === "institution" && (
          <div className="space-y-1.5">
            <label htmlFor="supporter-type" className="block text-sm font-medium text-slate-700">Kind of institution</label>
            <Select id="supporter-type" className="w-full" value={institutionType} onChange={(e) => setInstitutionType(e.target.value as (typeof INSTITUTION_TYPES)[number])}>
              {INSTITUTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Home country</label>
          <CountrySelect value={homeJurisdiction} onChange={setHomeJurisdiction} />
        </div>
        {error && (
          <Alert tone="danger" title="That didn't work">
            {error}
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="text-sm font-medium text-primary-700 hover:text-primary-800" onClick={onSetUpFoundation}>
            Set up a Foundation instead
          </button>
          <Button type="submit" disabled={submitting || !founderName.trim()}>
            {submitting ? "Saving…" : "Continue to give"}
            <IconArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
