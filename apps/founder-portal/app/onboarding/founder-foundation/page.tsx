"use client";

// Step 2 — the merge: what used to be sign-up's identity fields
// (Founder name/kind/institution type/home jurisdiction) plus Foundation
// establishment plus a logo, submitted together, atomically, to
// POST /founders/establish. multipart/form-data (not JSON) — a FormData
// body lets the browser set its own Content-Type with the multipart
// boundary, which is why apiFetch (lib/api.ts) skips its usual
// Content-Type: application/json header whenever the body is FormData.
import { useRef, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import { Alert, Button, Card, Input } from "@birr/ui";

const INSTITUTION_TYPES = [
  "islamic_bank",
  "university",
  "corporate_foundation",
  "ngo",
  "family_office",
  "government",
  "awqaf_authority",
  "other",
] as const;

export default function OnboardingFounderFoundationPage() {
  const [kind, setKind] = useState<"institution" | "individual">("institution");
  const [founderName, setFounderName] = useState("");
  const [institutionType, setInstitutionType] = useState<(typeof INSTITUTION_TYPES)[number]>("ngo");
  const [homeJurisdiction, setHomeJurisdiction] = useState("");

  const [foundationName, setFoundationName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    setLogoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("founderName", founderName);
      formData.set("kind", kind);
      if (kind === "institution") formData.set("institutionType", institutionType);
      if (homeJurisdiction) formData.set("homeJurisdiction", homeJurisdiction);
      formData.set("foundationName", foundationName);
      formData.set("purpose", purpose);
      if (jurisdiction) formData.set("jurisdiction", jurisdiction);
      if (logoFile) formData.set("logo", logoFile);

      await apiFetchJson("/founders/establish", { method: "POST", body: formData });
      window.location.reload();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const canSubmit =
    founderName.trim().length > 0 && foundationName.trim().length > 0 && purpose.trim().length > 0 && !submitting;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Establish your Foundation</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        This takes effect immediately — Birr becomes Mutawalli (trustee) over it as soon as it's created.
      </p>

      {submitError && (
        <Alert tone="danger" title="Couldn't establish your Foundation" className="mt-6">
          {submitError}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <Card>
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">Who is establishing</p>
          <div className="space-y-4">
            <div>
              <label htmlFor="kind" className="mb-1.5 block text-sm font-medium text-slate-700">
                Founder type
              </label>
              <select
                id="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as "institution" | "individual")}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="institution">Institution</option>
                <option value="individual">Individual</option>
              </select>
            </div>
            <div>
              <label htmlFor="founderName" className="mb-1.5 block text-sm font-medium text-slate-700">
                {kind === "institution" ? "Institution name" : "Your full name"}
              </label>
              <Input id="founderName" value={founderName} onChange={(e) => setFounderName(e.target.value)} required />
            </div>
            {kind === "institution" && (
              <div>
                <label htmlFor="institutionType" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Institution type
                </label>
                <select
                  id="institutionType"
                  value={institutionType}
                  onChange={(e) => setInstitutionType(e.target.value as (typeof INSTITUTION_TYPES)[number])}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {INSTITUTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {humanize(t)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="homeJurisdiction" className="mb-1.5 block text-sm font-medium text-slate-700">
                Home jurisdiction <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <Input
                id="homeJurisdiction"
                value={homeJurisdiction}
                onChange={(e) => setHomeJurisdiction(e.target.value)}
                placeholder="e.g. AE"
              />
            </div>
          </div>
        </Card>

        <Card>
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">Foundation</p>
          <div className="space-y-4">
            <div>
              <label htmlFor="foundationName" className="mb-1.5 block text-sm font-medium text-slate-700">
                Name
              </label>
              <Input
                id="foundationName"
                value={foundationName}
                onChange={(e) => setFoundationName(e.target.value)}
                required
              />
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
            <div>
              <label htmlFor="logo" className="mb-1.5 block text-sm font-medium text-slate-700">
                Logo <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <div className="flex items-center gap-4">
                {logoPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- object-URL preview of a local, not-yet-uploaded file; next/image's remote-loader doesn't apply here.
                  <img
                    src={logoPreviewUrl}
                    alt="Logo preview"
                    className="h-16 w-16 shrink-0 rounded-md border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
                    No logo
                  </div>
                )}
                <div>
                  <input
                    ref={fileInputRef}
                    id="logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoChange}
                    className="block text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">PNG, JPEG, or WebP. 2MB max.</p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {submitting ? "Establishing…" : "Establish Foundation"}
          </Button>
        </div>
      </form>
    </div>
  );
}
