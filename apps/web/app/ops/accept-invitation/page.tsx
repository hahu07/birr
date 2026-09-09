"use client";

// Landing page for an invitation link sent from /staff (Staff Management).
// The token in the URL is the credential — no session required to reach
// this page (see app-shell.tsx's PUBLIC_ROUTES), same posture as
// InvitationsController.accept on the backend. POST /invitations/accept
// sets the session cookie on success, so a successful accept logs the
// new staff member straight in.
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import { Alert, AuthSplitLayout, Button, IconMark, Input, PasswordInput } from "@birr/ui";
import { FounderFoundationGuide } from "../../(founder)/onboarding/founder-foundation/FounderFoundationGuide";

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
  const [founderKind, setFounderKind] = useState<FounderKind>("institution");
  const [institutionType, setInstitutionType] = useState<InstitutionType>("ngo");
  const [homeJurisdiction, setHomeJurisdiction] = useState("");

  const isCoFounder = kind === "co_founder";

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
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Join as a co-founder</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              You&apos;ll gain full, equal access to this Foundation and everything already established under it.
            </p>
          </div>

          {error && (
            <Alert tone="danger" title="Couldn't accept invitation" className="mb-6">
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">Who is establishing</p>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="founderKind" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Founder type
                    </label>
                    <select
                      id="founderKind"
                      value={founderKind}
                      onChange={(e) => setFounderKind(e.target.value as FounderKind)}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    >
                      <option value="institution">Institution</option>
                      <option value="individual">Individual</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="founderName" className="mb-1.5 block text-sm font-medium text-slate-700">
                      {founderKind === "institution" ? "Institution name" : "Your full name"}
                    </label>
                    <Input id="founderName" required value={founderName} onChange={(e) => setFounderName(e.target.value)} />
                  </div>
                  {founderKind === "institution" && (
                    <div>
                      <label htmlFor="institutionType" className="mb-1.5 block text-sm font-medium text-slate-700">
                        Institution type
                      </label>
                      <select
                        id="institutionType"
                        value={institutionType}
                        onChange={(e) => setInstitutionType(e.target.value as InstitutionType)}
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
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-500">Your account</p>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Full name
                    </label>
                    <Input id="fullName" required autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} />
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
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || (confirmPassword.length > 0 && password !== confirmPassword)}
                className="w-full rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-800 disabled:opacity-60"
              >
                {submitting ? "Joining…" : "Accept and join as co-founder"}
              </button>
            </div>

            <FounderFoundationGuide kind={founderKind} institutionType={institutionType} />
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
          <Input
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
