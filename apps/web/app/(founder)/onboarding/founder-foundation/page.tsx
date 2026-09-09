"use client";

// Step 2 — the merge: what used to be sign-up's identity fields
// (Founder name/kind/institution type/home jurisdiction) plus Foundation
// establishment plus a logo, submitted together, atomically, to
// POST /founders/establish. multipart/form-data (not JSON) — a FormData
// body lets the browser set its own Content-Type with the multipart
// boundary, which is why apiFetch (lib/api.ts) skips its usual
// Content-Type: application/json header whenever the body is FormData.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { humanize } from "../../../../lib/format";
import { ROUTE_FOR_STEP } from "../../../../lib/onboarding";
import type { Invitation } from "../../../../lib/types";
import { Alert, Button, Card, Input } from "@birr/ui";
import { FounderFoundationGuide } from "./FounderFoundationGuide";

interface PurposeSuggestion {
  suggestedPurpose: string;
}

interface EstablishResult {
  founder: { id: string };
  foundation: { id: string };
}

type CoFounderInviteResult =
  | { email: string; status: "sent"; emailSent: boolean; token: string }
  | { email: string; status: "failed"; error: string };

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

  // Joint establishment — invite co-founder(s) the moment the Foundation
  // is created, rather than requiring a separate later visit to the
  // Foundation's own page. Each is a brand-new Founder identity that
  // gets attached via the same POST /invitations (inviteeKind:
  // "co_founder") the Foundation detail page's own invite form uses —
  // no new backend endpoint needed.
  const [isJoint, setIsJoint] = useState(false);
  const [coFounderEmails, setCoFounderEmails] = useState<string[]>([""]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [inviteResults, setInviteResults] = useState<CoFounderInviteResult[] | null>(null);

  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // A founder can reach this route after step 2 is already done —
  // clicking "Back" from step 3, a bookmark, or (per app-shell's own
  // onboarding gate) revisiting an earlier-completed step's URL is
  // deliberately allowed, not bounced forward automatically. Rendering
  // the blank establish form here would be wrong (POST /founders/establish
  // already rejects a second attempt with a 409, but only after a
  // confusing resubmit) — but silently redirecting forward would make
  // "Back" a dead end, which defeats the whole point of it existing.
  // Show a summary instead and let the founder choose to continue.
  const [alreadyEstablished, setAlreadyEstablished] = useState<{
    founderName: string;
    kind: "institution" | "individual";
    institutionType: string | null;
    homeJurisdiction: string | null;
    foundationName: string;
    purpose: string | null;
    jurisdiction: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetchJson<{
      founder: {
        id: string;
        name: string;
        kind: "institution" | "individual";
        institutionType: string | null;
        homeJurisdiction: string | null;
      } | null;
    }>("/founders/me")
      .then((data) => {
        if (cancelled || !data.founder) return;
        return apiFetchJson<{ name: string; purpose: string | null; jurisdiction: string | null }[]>(
          "/foundations",
        ).then((foundations) => {
          if (cancelled) return;
          const foundation = foundations[0];
          setAlreadyEstablished({
            founderName: data.founder!.name,
            kind: data.founder!.kind,
            institutionType: data.founder!.institutionType,
            homeJurisdiction: data.founder!.homeJurisdiction,
            foundationName: foundation?.name ?? "",
            purpose: foundation?.purpose ?? null,
            jurisdiction: foundation?.jurisdiction ?? null,
          });
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDraftPurpose() {
    setDraftError(null);
    setDrafting(true);
    try {
      const result = await apiFetchJson<PurposeSuggestion>("/founders/onboarding/purpose-suggestion", {
        method: "POST",
        body: JSON.stringify({
          founderName,
          kind,
          institutionType: kind === "institution" ? institutionType : undefined,
          foundationName,
          jurisdiction: jurisdiction || undefined,
        }),
      });
      // Pre-fills, never auto-submits — Rafiq drafts for the Founder's
      // own review and editing, same posture as every other agent in
      // this codebase (CLAUDE.md: "AI is advisory only").
      setPurpose(result.suggestedPurpose);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setDrafting(false);
    }
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    setLogoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function updateCoFounderEmail(index: number, value: string) {
    setCoFounderEmails((prev) => prev.map((e, i) => (i === index ? value : e)));
  }

  function addCoFounderRow() {
    setCoFounderEmails((prev) => [...prev, ""]);
  }

  function removeCoFounderRow(index: number) {
    setCoFounderEmails((prev) => prev.filter((_, i) => i !== index));
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

      const result = await apiFetchJson<EstablishResult>("/founders/establish", { method: "POST", body: formData });

      const emails = isJoint ? [...new Set(coFounderEmails.map((email) => email.trim()).filter(Boolean))] : [];
      if (emails.length === 0) {
        // Full navigation straight to step 3's own route, not a reload
        // of this one — app-shell's onboarding gate deliberately leaves
        // an "earlier completed step" alone rather than bouncing it
        // forward (so looking back at a finished step doesn't fight the
        // URL), which means a same-URL reload right after JUST
        // finishing this step would otherwise strand the founder here
        // instead of advancing them.
        window.location.href = ROUTE_FOR_STEP[3];
        return;
      }

      // The Foundation is already established at this point — a
      // co-founder invite failing (e.g. a bad address) never rolls that
      // back, same "best-effort side channel" posture as everywhere else
      // in this codebase. Each result is surfaced below so the founder
      // can retry a failed one from the Foundation's own page later.
      const settled = await Promise.allSettled(
        emails.map((email) =>
          apiFetchJson<Invitation>("/invitations", {
            method: "POST",
            body: JSON.stringify({ inviteeKind: "co_founder", email, foundationId: result.foundation.id }),
          }),
        ),
      );
      setInviteResults(
        settled.map((r, i) =>
          r.status === "fulfilled"
            ? { email: emails[i], status: "sent", emailSent: Boolean(r.value.emailSent), token: r.value.token }
            : { email: emails[i], status: "failed", error: r.reason instanceof Error ? r.reason.message : "Something went wrong." },
        ),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const canSubmit =
    founderName.trim().length > 0 && foundationName.trim().length > 0 && purpose.trim().length > 0 && !submitting;

  if (inviteResults) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Foundation established</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Birr is now Mutawalli (trustee) over it. Here&apos;s the status of the co-founder invitation
          {inviteResults.length > 1 ? "s" : ""} you sent:
        </p>

        <div className="mt-6 space-y-3">
          {inviteResults.map((r) => (
            <div key={r.email} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-900">{r.email}</p>
              {r.status === "sent" ? (
                r.emailSent ? (
                  <p className="mt-1 text-xs text-primary-700">Invitation emailed.</p>
                ) : (
                  <div className="mt-2">
                    <p className="text-xs text-slate-600">
                      Couldn&apos;t send the email automatically — copy this link and send it to them yourself:
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="flex-1 truncate rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                        {`${typeof window !== "undefined" ? window.location.origin : ""}/ops/accept-invitation?token=${r.token}&kind=co_founder`}
                      </code>
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            `${window.location.origin}/ops/accept-invitation?token=${r.token}&kind=co_founder`,
                          )
                        }
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                <p className="mt-1 text-xs text-red-600">Couldn&apos;t send this invitation: {r.error}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="primary" onClick={() => (window.location.href = ROUTE_FOR_STEP[3])}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/onboarding/verify"
        className="mb-3 inline-flex items-center text-sm font-medium text-primary-700 hover:text-primary-800"
      >
        ← Back
      </Link>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {alreadyEstablished ? "Your Foundation is established" : "Establish your Foundation"}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        This takes effect immediately — Birr becomes Mutawalli (trustee) over it as soon as it's created.
      </p>

      {alreadyEstablished && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Who established it</p>
            <p className="text-sm font-semibold text-slate-900">{alreadyEstablished.founderName}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {alreadyEstablished.kind === "institution"
                ? humanize(alreadyEstablished.institutionType ?? "")
                : "Individual"}
              {alreadyEstablished.homeJurisdiction ? ` · ${alreadyEstablished.homeJurisdiction}` : ""}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Foundation</p>
            <p className="text-sm font-semibold text-slate-900">{alreadyEstablished.foundationName}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {[alreadyEstablished.purpose, alreadyEstablished.jurisdiction].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Link
            href={ROUTE_FOR_STEP[3]}
            className="inline-flex items-center text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            Continue to your Waqf Fund →
          </Link>
        </div>
      )}

      {submitError && (
        <Alert tone="danger" title="Couldn't establish your Foundation" className="mt-6">
          {submitError}
        </Alert>
      )}

      {!alreadyEstablished && (
      <form onSubmit={handleSubmit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
        <div className="space-y-6">
        <Card>
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">Who is establishing</p>
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
                Home jurisdiction <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <Input
                id="homeJurisdiction"
                value={homeJurisdiction}
                onChange={(e) => setHomeJurisdiction(e.target.value)}
                placeholder="e.g. NG"
              />
            </div>
            <div className="border-t border-slate-100 pt-4">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={isJoint}
                  onChange={(e) => setIsJoint(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-slate-700">
                  This Foundation is being established jointly with other founder(s)
                </span>
              </label>
              {isJoint && (
                <div className="mt-3 space-y-2.5">
                  {coFounderEmails.map((email, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => updateCoFounderEmail(index, e.target.value)}
                        placeholder="co-founder@example.com"
                        className="flex-1"
                      />
                      {coFounderEmails.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeCoFounderRow(index)}
                          className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-600"
                          aria-label="Remove co-founder"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addCoFounderRow}
                    className="text-xs font-medium text-primary-700 hover:text-primary-800"
                  >
                    + Add another co-founder
                  </button>
                  <p className="text-xs text-slate-500">
                    Each will create their own Founder identity and gain full, equal access to this Foundation —
                    invited the moment it&apos;s established. You can also invite more later from the Foundation&apos;s
                    own page.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">Foundation</p>
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
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="purpose" className="block text-sm font-medium text-slate-700">
                  Purpose
                </label>
                <button
                  type="button"
                  onClick={handleDraftPurpose}
                  disabled={drafting || !founderName.trim() || !foundationName.trim()}
                  title={
                    !founderName.trim() || !foundationName.trim()
                      ? "Fill in the name fields above first"
                      : undefined
                  }
                  className="text-xs font-medium text-primary-700 hover:text-primary-800 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  {drafting ? "Drafting…" : "✦ Help me write this"}
                </button>
              </div>
              {draftError && <p className="mb-1.5 text-xs text-red-600">{draftError}</p>}
              <textarea
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                required
                placeholder={'e.g. "Supporting Islamic education and orphan welfare across Northern Nigeria." This becomes part of the dedication itself.'}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Rafiq, Birr's onboarding assistant, can draft a starting point — always yours to review and edit
                before submitting.
              </p>
            </div>
            <div>
              <label htmlFor="jurisdiction" className="mb-1.5 block text-sm font-medium text-slate-700">
                Jurisdiction <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <Input
                id="jurisdiction"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g. NG"
              />
            </div>
            <div>
              <label htmlFor="logo" className="mb-1.5 block text-sm font-medium text-slate-700">
                Logo <span className="font-normal text-slate-500">(optional)</span>
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
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-500">
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
        </div>

        <FounderFoundationGuide kind={kind} institutionType={institutionType} />
      </form>
      )}
    </div>
  );
}
