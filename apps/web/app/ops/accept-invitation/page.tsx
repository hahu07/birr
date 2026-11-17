"use client";

// Landing page for an invitation link sent from /staff (Staff Management).
// The token in the URL is the credential — no session required to reach
// this page (see app-shell.tsx's PUBLIC_ROUTES), same posture as
// InvitationsController.accept on the backend. POST /invitations/accept
// sets the session cookie on success, so a successful accept logs the
// new staff member straight in.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, apiFetchJson } from "../../../lib/api";
import { Alert, AuthSplitLayout, Button, IconFileText, IconMark, Input, PasswordInput, Select, Skeleton } from "@birr/ui";
import { ChoiceCard, Field, FormSection, inputClass } from "../../(founder)/_components/form";
import {
  FOUNDER_TYPE_GUIDE,
  FounderFoundationGuide,
  INSTITUTION_TYPE_GUIDE,
} from "../../(founder)/onboarding/founder-foundation/FounderFoundationGuide";
import { CountrySelect } from "../../../components/forms/CountrySelect";

type FounderKind = "institution" | "individual";
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
type InstitutionType = (typeof INSTITUTION_TYPES)[number];

// GET /invitations/preview — see InvitationsService.previewCoFounderInvitation.
interface CoFounderInvitationPreview {
  email: string;
  foundationName: string;
  establishedJointly: boolean;
  invitedByName: string;
  deed: { signerName: string; signedAt: string } | null;
  statement: { kind: "adopt_signed_deed" | "authorize_signer"; text: string; version: string; hash: string };
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitationContent />
    </Suspense>
  );
}

function AcceptInvitationContent() {
  const params = useSearchParams();
  const token = params.get("token");
  const kind = params.get("kind"); // "co_founder" carried on the invite link itself — see InvitationsService.invite

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Only meaningful when kind === "co_founder" — the new Founder identity
  // being established, same fields as onboarding step 2.
  const [founderName, setFounderName] = useState("");
  const [founderKind, setFounderKind] = useState<FounderKind>("individual");
  const [institutionType, setInstitutionType] = useState<InstitutionType>("ngo");
  const [homeJurisdiction, setHomeJurisdiction] = useState("");

  const isCoFounder = kind === "co_founder";

  // A co-founder's own money is dedicated under the Foundation's deed, so
  // they're shown exactly what they're agreeing to about it, and accept it,
  // before joining (owner's decision, 2026-11-14).
  const [preview, setPreview] = useState<CoFounderInvitationPreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [acceptsStatement, setAcceptsStatement] = useState(false);
  useEffect(() => {
    if (!isCoFounder || !token) return;
    let cancelled = false;
    apiFetchJson<CoFounderInvitationPreview>(`/invitations/preview?token=${encodeURIComponent(token)}`)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        // Family or friends join a joint Foundation as individuals, never an institution.
        if (data.establishedJointly) setFounderKind("individual");
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isCoFounder, token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { token, fullName, password };
      if (isCoFounder) {
        body.founderName = founderName;
        body.kind = founderKind;
        if (founderKind === "institution") body.institutionType = institutionType;
        if (homeJurisdiction) body.homeJurisdiction = homeJurisdiction;
        body.deedConsentVersion = preview?.statement.version;
        body.deedStatementHash = preview?.statement.hash;
      }
      const result = await apiFetchJson<{ invitation: { inviteeKind: "founder_user" | "birr_staff" | "co_founder" } }>(
        "/invitations/accept",
        { method: "POST", body: JSON.stringify(body) },
      );
      // Full navigation — forces the relevant session provider
      // (StaffSessionProvider or FounderSessionProvider) to remount and
      // pick up the session cookie POST /invitations/accept just set.
      // founder_user and co_founder invitees both land in the Founder
      // Portal — neither has a staff session, and would otherwise be
      // stuck in a redirect loop back to /ops/sign-in.
      window.location.href = result.invitation.inviteeKind === "birr_staff" ? "/ops" : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
      // The deed was signed while they read: show the statement that now
      // applies, and have them accept that one.
      if (err instanceof ApiError && err.code === "statement_changed" && token) {
        setAcceptsStatement(false);
        apiFetchJson<CoFounderInvitationPreview>(`/invitations/preview?token=${encodeURIComponent(token)}`)
          .then(setPreview)
          .catch(() => setPreviewError(true));
      }
    }
  }

  if (!token) {
    return (
      <AuthSplitLayout
        eyebrow="Invitation"
        headline="A digital trustee for Islamic waqf."
        subcopy="Birr is appointed Mutawalli (trustee) for every waqf established through it — establishment is self-service, ongoing governance is Birr-staff-mediated."
      >
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <IconMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Birr</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Invalid invitation link</h1>
        <p className="mt-2 text-sm text-slate-500">This link is missing its invitation token.</p>
      </AuthSplitLayout>
    );
  }

  if (isCoFounder) {
    if (previewError) {
      return (
        <div className="min-h-screen bg-slate-50 px-4 py-16">
          <div className="mx-auto max-w-md text-center">
            <h1 className="font-display text-2xl font-medium tracking-tight text-slate-900">This invitation isn&apos;t valid anymore</h1>
            <p className="mt-2 text-sm text-slate-500">
              It may have been used already, withdrawn, or expired. Ask the founder who invited you to send a new one.
            </p>
          </div>
        </div>
      );
    }
    if (!preview) {
      return (
        <div className="min-h-screen bg-slate-50 px-4 py-12">
          <div className="mx-auto max-w-4xl space-y-4">
            <Skeleton className="mx-auto h-8 w-72" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      );
    }
    const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <IconMark className="mx-auto h-10 w-10" />
            <h1 className="font-display mt-4 text-3xl font-medium tracking-tight text-slate-900">
              Join {preview.foundationName} as a co-founder
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {preview.invitedByName} invited {preview.email}. You&apos;ll have full, equal access to the Foundation and everything
              established under it.
            </p>
          </div>

          {error && (
            <Alert tone="danger" title="Couldn't accept invitation" className="mb-6">
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
            <div className="space-y-6">
              <FormSection step={1} title="Who's joining" description="You, or the organization you're joining on behalf of.">
                <div className="space-y-5">
                  {preview.establishedJointly ? (
                    <p className="rounded-xl bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600">
                      {preview.foundationName} was established jointly by family or friends, so you join it as an{" "}
                      <span className="font-medium text-slate-900">individual</span>.
                    </p>
                  ) : (
                    <fieldset>
                      <legend className="mb-2 block text-sm font-medium text-slate-800">Founder type</legend>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {(["individual", "institution"] as const).map((k) => (
                          <ChoiceCard
                            key={k}
                            name="founderKind"
                            checked={founderKind === k}
                            onChange={() => setFounderKind(k)}
                            title={FOUNDER_TYPE_GUIDE[k].label}
                            body={FOUNDER_TYPE_GUIDE[k].description}
                          />
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <Field label={founderKind === "institution" ? "Institution name" : "Your full name"} htmlFor="founderName">
                    <input id="founderName" required value={founderName} onChange={(e) => setFounderName(e.target.value)} className={inputClass} />
                  </Field>
                  {founderKind === "institution" && (
                    <Field label="Institution type" htmlFor="institutionType">
                      <Select id="institutionType" value={institutionType} onChange={(e) => setInstitutionType(e.target.value as InstitutionType)}>
                        {INSTITUTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {INSTITUTION_TYPE_GUIDE[t].label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field
                    label="Home jurisdiction"
                    htmlFor="homeJurisdiction"
                    optional
                    hint="The country where you're based."
                  >
                    <CountrySelect id="homeJurisdiction" value={homeJurisdiction} onChange={setHomeJurisdiction} className="sm:max-w-sm" />
                  </Field>
                </div>
              </FormSection>

              <FormSection step={2} title="Your account" description="How you'll sign in to Birr.">
                <div className="space-y-5">
                  <Field label="Full name" htmlFor="fullName">
                    <Input check="name" id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </Field>
                  <Field label="Password" htmlFor="password" hint="At least 8 characters.">
                    <PasswordInput
                      id="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                  <div>
                    <Field label="Confirm password" htmlFor="confirmPassword">
                      <PasswordInput
                        id="confirmPassword"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </Field>
                    {passwordsMismatch && <p className="mt-1.5 text-xs text-red-600">Passwords don&apos;t match.</p>}
                  </div>
                </div>
              </FormSection>

              <FormSection
                step={3}
                title="The Foundation's deed"
                description={
                  preview.deed
                    ? `Its Deed of Waqf was signed by ${preview.deed.signerName} on ${formatDate(preview.deed.signedAt)}. Joining means it applies to you too.`
                    : "Its Deed of Waqf isn't signed yet. One founder signs it for everyone; joining means you agree to that."
                }
              >
                <blockquote className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
                  <IconFileText className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" />
                  <span>{preview.statement.text}</span>
                </blockquote>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 text-sm text-slate-700 transition-colors hover:border-slate-300 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50/70">
                  <input
                    type="checkbox"
                    required
                    checked={acceptsStatement}
                    onChange={(e) => setAcceptsStatement(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700"
                  />
                  <span>I accept this statement. Birr keeps a dated record of it.</span>
                </label>
              </FormSection>

              <Button
                type="submit"
                variant="primary"
                disabled={submitting || passwordsMismatch || !acceptsStatement}
                className="w-full rounded-lg py-2.5"
              >
                {submitting ? "Joining…" : "Accept and join as co-founder"}
              </Button>
            </div>

            <FounderFoundationGuide
              founderType={preview.establishedJointly ? "joint" : founderKind}
              institutionType={institutionType}
              showNextSteps={false}
            />
          </form>
        </div>
      </div>
    );
  }

  return (
    <AuthSplitLayout
      eyebrow="Invitation"
      headline="A digital trustee for Islamic waqf."
      subcopy="Birr is appointed Mutawalli (trustee) for every waqf established through it — establishment is self-service, ongoing governance is Birr-staff-mediated."
    >
      <div className="mb-8 flex items-center gap-2.5 lg:hidden">
        <IconMark className="h-9 w-9" />
        <span className="text-lg font-semibold tracking-tight text-slate-900">Birr</span>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Join Birr</h1>
      <p className="mt-2 text-sm text-slate-500">Set your name and password to accept your invitation.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {error && (
          <Alert tone="danger" title="Couldn't accept invitation">
            {error}
          </Alert>
        )}
        <div>
          <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-slate-700">
            Full name
          </label>
          <Input check="name"
            id="fullName"
            required
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
            Password
          </label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {confirmPassword.length > 0 && password !== confirmPassword && (
            <p className="mt-1.5 text-xs text-red-600">Passwords don't match.</p>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={submitting || (confirmPassword.length > 0 && password !== confirmPassword)}
          className="w-full"
        >
          {submitting ? "Joining…" : "Accept invitation"}
        </Button>
      </form>
    </AuthSplitLayout>
  );
}
