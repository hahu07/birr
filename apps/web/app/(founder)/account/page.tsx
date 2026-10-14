"use client";

// Account & security — the one standing settings surface the Founder
// Portal has (WhatsApp verification lives inside onboarding, not here,
// since it's a one-time prerequisite rather than an ongoing setting).
// MFA here is opt-in, unlike birr_staff's mandatory setup
// (SessionAuthGuard forces every staff member through enrollment) —
// Founders self-service sign up through this "lightweight" portal
// (CLAUDE.md), and forcing enrollment at signup would add real
// onboarding friction with no equivalent internal-mandate
// justification. Nothing here blocks any other route if MFA stays off.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { useFounderSession } from "../../../lib/founder-session";
import type {
  MfaEnrollmentConfirm,
  MfaEnrollmentStart,
  NotificationPreferenceCategory,
  NotificationPreferences,
} from "../../../lib/types";
import { Alert, Badge, Button, IconShieldCheck, Input, Skeleton } from "@birr/ui";
import { PageHeader, Panel } from "../_components/ui";

type EnrollStep = "idle" | "starting" | "scan" | "backup-codes";

export default function AccountPage() {
  const { user, loading } = useFounderSession();

  if (loading || !user) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  const initials = user.fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0))
    .filter((_, i, all) => i === 0 || i === all.length - 1)
    .join("")
    .toUpperCase();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Account" title="Account & security" />

      <Panel className="mb-6">
        <div className="flex items-center gap-4 p-5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-300 to-accent-500 text-lg font-bold text-accent-950">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">{user.fullName}</p>
            <p className="truncate text-sm text-slate-500">{user.email}</p>
            <p className="mt-1 text-xs text-slate-500">
              WhatsApp {user.whatsappVerifiedAt ? <span className="font-medium text-primary-700">verified</span> : "not verified"}
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="mb-6">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${user.mfaEnabled ? "bg-primary-50 text-primary-700" : "bg-slate-100 text-slate-500"}`}
            >
              <IconShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Two-factor authentication</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                {user.mfaEnabled
                  ? "Enabled — signing in also asks for a code from your authenticator app."
                  : "Add an extra step at sign-in using an authenticator app (Google Authenticator, 1Password, Authy, or similar). Recommended for anyone who can move money."}
              </p>
            </div>
          </div>
          <Badge tone={user.mfaEnabled ? "success" : "neutral"} className="shrink-0 whitespace-nowrap">
            {user.mfaEnabled ? "Enabled" : "Off"}
          </Badge>
        </div>
        <div className="border-t border-slate-100 px-5 py-4">
          {user.mfaEnabled ? (
            <p className="text-xs text-slate-500">
              Lost your device and your backup codes? Contact Birr — only a platform admin can reset this for you.
            </p>
          ) : (
            <EnrollFlow />
          )}
        </div>
      </Panel>

      <Panel>
        <div className="p-5 pb-0">
          <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
          <p className="mt-1 text-sm text-slate-500">
            You always see these in the bell — choose which ones also email or WhatsApp you
            {user.whatsappVerifiedAt ? "" : " (WhatsApp needs a verified number first)"}.
          </p>
        </div>
        <NotificationPreferencesForm whatsappVerified={Boolean(user.whatsappVerifiedAt)} />
      </Panel>
    </div>
  );
}

const CATEGORY_LABELS: Record<NotificationPreferenceCategory, { title: string; description: string }> = {
  governance: {
    title: "Governance & waqf status",
    description: "A fund is activated, a deed is signed, or Birr staff decides on a proposal you're involved in.",
  },
  money: {
    title: "Money movement",
    description: "A distribution is paid out, or a contribution is confirmed or fails.",
  },
  team: {
    title: "Team & causes",
    description: "A co-founder or teammate joins, or a cause suggestion you submitted is reviewed.",
  },
  messages: {
    title: "Messages",
    description: "Birr staff sends you a message.",
  },
};

function NotificationPreferencesForm({ whatsappVerified }: { whatsappVerified: boolean }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState<NotificationPreferenceCategory | null>(null);

  useEffect(() => {
    apiFetchJson<NotificationPreferences>("/notifications/preferences")
      .then(setPreferences)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load notification preferences."));
  }, []);

  async function handleToggle(category: NotificationPreferenceCategory, field: "emailEnabled" | "whatsappEnabled") {
    if (!preferences) return;
    const next = { ...preferences[category], [field]: !preferences[category][field] };
    setPreferences({ ...preferences, [category]: next });
    setSavingCategory(category);
    setError(null);
    try {
      await apiFetchJson(`/notifications/preferences/${category}`, { method: "PUT", body: JSON.stringify(next) });
    } catch (err) {
      // Roll back on failure — the checkbox already flipped optimistically above.
      setPreferences((current) => (current ? { ...current, [category]: preferences[category] } : current));
      setError(err instanceof Error ? err.message : "Couldn't save that — try again.");
    } finally {
      setSavingCategory(null);
    }
  }

  if (error && !preferences) {
    return (
      <div className="p-5">
        <Alert tone="danger" title="Couldn't load notification preferences">
          {error}
        </Alert>
      </div>
    );
  }

  if (!preferences) {
    return <Skeleton className="m-5 h-40" />;
  }

  // One grid for every row, with a header row naming the two channel
  // columns — the toggles used to sit in a flex-wrap row that wrapped
  // under the description on some rows and not others, so the Email and
  // WhatsApp checkboxes never lined up down the page.
  return (
    <div className="mt-4">
      {error && (
        <div className="px-5 pb-3">
          <Alert tone="danger" title="Couldn't save">
            {error}
          </Alert>
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:gap-x-8">
        <span>Notify me about</span>
        <span className="w-[4.5rem] text-center">Email</span>
        <span className={`w-[4.5rem] text-center ${whatsappVerified ? "" : "text-slate-300"}`}>WhatsApp</span>
      </div>
      <div className="divide-y divide-slate-100">
        {(Object.keys(CATEGORY_LABELS) as NotificationPreferenceCategory[]).map((category) => {
          const { title, description } = CATEGORY_LABELS[category];
          const value = preferences[category];
          return (
            <div key={category} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-5 py-4 sm:gap-x-8">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
              </div>
              <div className="flex w-[4.5rem] justify-center">
                <Toggle
                  label={`Email — ${title}`}
                  checked={value.emailEnabled}
                  disabled={savingCategory === category}
                  onChange={() => handleToggle(category, "emailEnabled")}
                />
              </div>
              <div className="flex w-[4.5rem] justify-center">
                <Toggle
                  label={`WhatsApp — ${title}`}
                  checked={value.whatsappEnabled}
                  disabled={savingCategory === category || !whatsappVerified}
                  onChange={() => handleToggle(category, "whatsappEnabled")}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A checkbox styled as an on/off switch — still a real <input type="checkbox"> for keyboard and screen readers. */
function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <label className={`relative inline-flex ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
      <span className="h-6 w-11 rounded-full bg-slate-200 transition-colors peer-checked:bg-primary-600 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2" />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
    </label>
  );
}

function EnrollFlow() {
  const [step, setStep] = useState<EnrollStep>("idle");
  const [enrollment, setEnrollment] = useState<MfaEnrollmentStart | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    setError(null);
    setStep("starting");
    try {
      const data = await apiFetchJson<MfaEnrollmentStart>("/founders/me/mfa/enroll", { method: "POST" });
      setEnrollment(data);
      setStep("scan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStep("idle");
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetchJson<MfaEnrollmentConfirm>("/founders/me/mfa/enroll/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setBackupCodes(result.backupCodes);
      setStep("backup-codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "idle") {
    return (
      <>
        {error && (
          <Alert tone="danger" title="Couldn't start two-factor setup" className="mb-3">
            {error}
          </Alert>
        )}
        <Button variant="primary" onClick={handleStart}>
          Enable two-factor authentication
        </Button>
      </>
    );
  }

  if (step === "starting") {
    return <p className="text-sm text-slate-500">Setting up…</p>;
  }

  if (step === "scan" && enrollment) {
    return (
      <div>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a base64 data URL, not an optimizable remote/static asset */}
          <img
            src={enrollment.qrCodeDataUrl}
            alt="Scan this QR code with your authenticator app"
            className="h-40 w-40 rounded-lg border border-slate-200"
          />
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">Can&apos;t scan it? Enter this code manually:</p>
        <p className="mt-1 break-all rounded-md bg-slate-100 px-3 py-2 text-center font-mono text-sm text-slate-700">
          {enrollment.secretForManualEntry}
        </p>
        <form onSubmit={handleConfirm} className="mt-4 space-y-3">
          {error && (
            <Alert tone="danger" title="Couldn't confirm">
              {error}
            </Alert>
          )}
          <div>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-slate-700">
              Enter the 6-digit code from your app
            </label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" disabled={submitting} className="w-full">
            {submitting ? "Confirming…" : "Confirm and enable"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <Alert tone="warning" title="Save your backup codes — shown only once">
        If you lose access to your authenticator app, any one of these codes signs you in instead. Save them
        somewhere safe — only a platform admin can reset this if you lose both.
      </Alert>
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-4 font-mono text-sm text-slate-700">
        {backupCodes.map((backupCode) => (
          <span key={backupCode}>{backupCode}</span>
        ))}
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => {
          // Full reload, not local state — forces FounderSessionProvider
          // to remount and re-fetch GET /founders/me, which now reports
          // mfaEnabled: true.
          window.location.reload();
        }}
      >
        I&apos;ve saved these — done
      </Button>
    </div>
  );
}
