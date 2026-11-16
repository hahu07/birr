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
import { Alert, Button, IconArrowRight, IconImage, IconShieldCheck, IconSparkle, Select } from "@birr/ui";
import { ChoiceCard, Field, FormSection, inputClass } from "../../_components/form";
import { FOUNDER_TYPE_GUIDE, FounderFoundationGuide, type FounderType, INSTITUTION_TYPE_GUIDE } from "./FounderFoundationGuide";
import { CountrySelect } from "../../../../components/forms/CountrySelect";

interface PurposeSuggestion {
  suggestedPurpose: string;
  draftId: string;
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
  const [founderType, setFounderType] = useState<FounderType>("institution");
  // Joint founders are individuals: an informal group isn't an institution.
  const kind = founderType === "institution" ? "institution" : "individual";
  const [founderName, setFounderName] = useState("");
  const [institutionType, setInstitutionType] = useState<(typeof INSTITUTION_TYPES)[number]>("ngo");
  const [homeJurisdiction, setHomeJurisdiction] = useState("");

  const [foundationName, setFoundationName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  // Set whenever Rafiq actually returns a suggestion — echoed back on
  // submit so the backend can record an honest disposition (used as
  // offered, or changed) against this specific suggestion, not a
  // guessed "most recent draft for this user" (see
  // EstablishFounderAndFoundationInput.rafiqDraftId's own comment).
  // Re-drafting overwrites this with the newest suggestion shown.
  const [rafiqDraftId, setRafiqDraftId] = useState<string | null>(null);

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
      setRafiqDraftId(result.draftId);
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

  function handleRemoveLogo() {
    setLogoFile(null);
    setLogoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      if (founderType === "joint") formData.set("establishedJointly", "true");
      if (homeJurisdiction) formData.set("homeJurisdiction", homeJurisdiction);
      formData.set("foundationName", foundationName);
      formData.set("purpose", purpose);
      if (jurisdiction) formData.set("jurisdiction", jurisdiction);
      if (logoFile) formData.set("logo", logoFile);
      if (rafiqDraftId) formData.set("rafiqDraftId", rafiqDraftId);

      const result = await apiFetchJson<EstablishResult>("/founders/establish", { method: "POST", body: formData });

      const emails = invitingCoFounders ? [...new Set(coFounderEmails.map((email) => email.trim()).filter(Boolean))] : [];
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

  // Choosing "Jointly" opens the co-founder invites without the extra tick.
  const invitingCoFounders = founderType === "joint" || isJoint;

  const canSubmit =
    founderName.trim().length > 0 && foundationName.trim().length > 0 && purpose.trim().length > 0 && !submitting;

  if (inviteResults) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">Foundation established</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Birr is now Mutawalli (trustee) over it. Here&apos;s the status of the co-founder invitation
          {inviteResults.length > 1 ? "s" : ""} you sent:
        </p>

        <div className="mt-6 space-y-3">
          {inviteResults.map((r) => (
            <div key={r.email} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">{r.email}</p>
              {r.status === "sent" ? (
                r.emailSent ? (
                  <p className="mt-1 text-xs font-medium text-primary-700">Invitation emailed.</p>
                ) : (
                  <div className="mt-2">
                    <p className="text-xs text-slate-600">
                      Couldn&apos;t send the email automatically — copy this link and send it to them yourself:
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
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
          <Button variant="primary" className="rounded-lg px-5 py-2.5" onClick={() => (window.location.href = ROUTE_FOR_STEP[3])}>
            Continue to your Waqf Fund
            <IconArrowRight className="h-4 w-4" />
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
      <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">
        {alreadyEstablished ? "Your Foundation is established" : "Establish your Foundation"}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        This takes effect immediately — Birr becomes Mutawalli (trustee) over it as soon as it's created.
      </p>

      {alreadyEstablished && (
        <div className="mt-6 max-w-2xl space-y-4">
          <SummaryCard label="Who established it" title={alreadyEstablished.founderName}>
            {alreadyEstablished.kind === "institution" ? humanize(alreadyEstablished.institutionType ?? "") : "Individual"}
            {alreadyEstablished.homeJurisdiction ? ` · ${alreadyEstablished.homeJurisdiction}` : ""}
          </SummaryCard>
          <SummaryCard label="Foundation" title={alreadyEstablished.foundationName}>
            {[alreadyEstablished.purpose, alreadyEstablished.jurisdiction].filter(Boolean).join(" · ")}
          </SummaryCard>
          <div className="flex justify-end">
            <Link
              href={ROUTE_FOR_STEP[3]}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-900/20 hover:bg-primary-800"
            >
              Continue to your Waqf Fund
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}

      {submitError && (
        <Alert tone="danger" title="Couldn't establish your Foundation" className="mt-6">
          {submitError}
        </Alert>
      )}

      {!alreadyEstablished && (
        <form onSubmit={handleSubmit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="space-y-6">
            <FormSection step={1} title="Who's establishing it" description="The person or organization dedicating this endowment.">
              <div className="space-y-5">
                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-slate-800">Founder type</legend>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {(["institution", "individual", "joint"] as const).map((t) => (
                      <ChoiceCard
                        key={t}
                        name="founderType"
                        checked={founderType === t}
                        onChange={() => setFounderType(t)}
                        title={FOUNDER_TYPE_GUIDE[t].label}
                        body={FOUNDER_TYPE_GUIDE[t].description}
                      />
                    ))}
                  </div>
                </fieldset>
                <Field label={kind === "institution" ? "Institution name" : "Your full name"} htmlFor="founderName">
                  <input
                    id="founderName"
                    value={founderName}
                    onChange={(e) => setFounderName(e.target.value)}
                    required
                    placeholder={kind === "institution" ? 'e.g. "Kano Islamic Relief Initiative"' : 'e.g. "Amina Bello"'}
                    className={inputClass}
                  />
                </Field>
                {kind === "institution" && (
                  <Field label="Institution type" htmlFor="institutionType">
                    <Select
                      id="institutionType"
                      value={institutionType}
                      onChange={(e) => setInstitutionType(e.target.value as (typeof INSTITUTION_TYPES)[number])}
                    >
                      {INSTITUTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {INSTITUTION_TYPE_GUIDE[t].label}
                        </option>
                      ))}
                    </Select>
                    {/* On desktop the guide beside the form carries this. */}
                    <p className="mt-1.5 text-xs italic leading-relaxed text-slate-500 lg:hidden">
                      e.g. {INSTITUTION_TYPE_GUIDE[institutionType].example}
                    </p>
                  </Field>
                )}
                <Field
                  label="Home jurisdiction"
                  htmlFor="homeJurisdiction"
                  optional
                  hint="Where you're based, as a 2-letter country code — e.g. NG for Nigeria."
                >
                  <input
                    id="homeJurisdiction"
                    value={homeJurisdiction}
                    onChange={(e) => setHomeJurisdiction(e.target.value)}
                    placeholder="NG"
                    className={`${inputClass} sm:max-w-[12rem]`}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection
              step={2}
              title="Your Foundation"
              description="The umbrella every Waqf Fund you establish sits under. You can add more funds to it later."
            >
              <div className="space-y-5">
                <Field label="Name" htmlFor="foundationName">
                  <input
                    id="foundationName"
                    value={foundationName}
                    onChange={(e) => setFoundationName(e.target.value)}
                    required
                    placeholder='e.g. "Hope for Kids Foundation"'
                    className={inputClass}
                  />
                </Field>
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label htmlFor="purpose" className="block text-sm font-medium text-slate-800">
                      Purpose
                    </label>
                    <button
                      type="button"
                      onClick={handleDraftPurpose}
                      disabled={drafting || !founderName.trim() || !foundationName.trim()}
                      title={!founderName.trim() || !foundationName.trim() ? "Fill in both names first" : undefined}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <IconSparkle className="h-3.5 w-3.5" />
                      {drafting ? "Drafting…" : "Help me write this"}
                    </button>
                  </div>
                  <textarea
                    id="purpose"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    rows={4}
                    required
                    placeholder='e.g. "Supporting Islamic education and orphan welfare across Northern Nigeria."'
                    className={`${inputClass} resize-y`}
                  />
                  {draftError && <p className="mt-1.5 text-xs text-red-600">{draftError}</p>}
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    This becomes part of the dedication itself. Rafiq, Birr&apos;s onboarding assistant, can draft a starting
                    point once both names are filled in — always yours to review and edit.
                  </p>
                </div>
                <Field
                  label="Jurisdiction"
                  htmlFor="jurisdiction"
                  optional
                  hint="The country whose rules govern the Foundation."
                >
                  <CountrySelect id="jurisdiction" value={jurisdiction} onChange={setJurisdiction} className="sm:max-w-sm" />
                </Field>
                <div>
                  <p className="mb-1.5 block text-sm font-medium text-slate-800">
                    Logo <span className="font-normal text-slate-500">(optional)</span>
                  </p>
                  <div className="flex items-center gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500/40">
                    {logoPreviewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- object-URL preview of a local, not-yet-uploaded file; next/image's remote-loader doesn't apply here.
                      <img
                        src={logoPreviewUrl}
                        alt="Logo preview"
                        className="h-16 w-16 shrink-0 rounded-xl border border-slate-200 bg-white object-cover"
                      />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400">
                        <IconImage className="h-6 w-6" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <label
                          htmlFor="logo"
                          className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          {logoFile ? "Change logo" : "Upload logo"}
                        </label>
                        {logoFile && (
                          <button type="button" onClick={handleRemoveLogo} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                            Remove
                          </button>
                        )}
                      </div>
                      <p className="mt-1.5 truncate text-xs text-slate-500">{logoFile ? logoFile.name : "PNG, JPEG or WebP, up to 2MB."}</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      id="logo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleLogoChange}
                      className="sr-only"
                    />
                  </div>
                </div>
              </div>
            </FormSection>

            <FormSection
              step={3}
              title="Co-founders"
              description={
                founderType === "joint"
                  ? "Invite the family or friends establishing this with you. You can also invite them later, from your Foundation's page."
                  : "Optional. Establishing this jointly? Invite them now, or later from your Foundation's page."
              }
            >
              {founderType !== "joint" && (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 transition-colors hover:border-slate-300 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50/70">
                <input
                  type="checkbox"
                  checked={isJoint}
                  onChange={(e) => setIsJoint(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">Establish this jointly with other founders</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                    Each gets their own Founder account, with full, equal access to this Foundation.
                  </span>
                </span>
              </label>
              )}
              {invitingCoFounders && (
                <div className={`space-y-2.5 ${founderType === "joint" ? "" : "mt-4"}`}>
                  {coFounderEmails.map((email, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => updateCoFounderEmail(index, e.target.value)}
                        placeholder="co-founder@example.com"
                        aria-label={`Co-founder ${index + 1} email`}
                        className={`${inputClass} flex-1`}
                      />
                      {coFounderEmails.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeCoFounderRow(index)}
                          className="shrink-0 rounded-lg px-2 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Remove co-founder ${index + 1}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addCoFounderRow} className="text-sm font-medium text-primary-700 hover:text-primary-800">
                    + Add another co-founder
                  </button>
                  <p className="text-xs text-slate-500">They&apos;re invited by email the moment your Foundation is established.</p>
                </div>
              )}
            </FormSection>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                    <IconShieldCheck className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <p className="text-sm text-slate-600">
                      {canSubmit ? "Ready to establish your Foundation." : "Fill in the names and the purpose to continue."}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">It takes effect as soon as you submit. Next, your first Waqf Fund.</p>
                  </div>
                </div>
                <Button type="submit" variant="primary" disabled={!canSubmit} className="shrink-0 rounded-lg px-5 py-2.5 font-semibold">
                  {submitting ? "Establishing…" : "Establish Foundation"}
                </Button>
              </div>
            </div>
          </div>

          <FounderFoundationGuide founderType={founderType} institutionType={institutionType} />
        </form>
      )}
    </div>
  );
}

function SummaryCard({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-0.5 text-sm text-slate-500">{children}</p>
    </div>
  );
}
