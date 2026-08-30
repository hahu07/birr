"use client";

// A staff member's own profile — currently just WhatsApp verification,
// deliberately not a new sidebar section (reached via clicking your own
// name/avatar in the sidebar footer — see app-shell.tsx's Sidebar). No
// onboarding-order gate, unlike the Founder Portal's equivalent
// (BirrStaffWhatsAppService has none) — just "you're signed in."
// Verifying here is what lets a staff member actually receive a
// WhatsApp notification (e.g. a governed action awaiting their review) —
// see NotificationsService.notify(), which silently skips the WhatsApp
// channel for anyone without a verified number.
import { useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { useStaffSession } from "../../../lib/staff-session";
import { Alert, Button, Card, Input, Skeleton } from "@birr/ui";

export default function ProfilePage() {
  const { staff, loading } = useStaffSession();

  if (loading || !staff) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">My Profile</h1>
      <p className="mt-1.5 text-sm text-slate-500">{staff.user.fullName} · {staff.user.email}</p>

      <div className="mt-6">
        {staff.user.whatsappVerifiedAt ? (
          <Card>
            <p className="text-sm font-medium text-slate-800">WhatsApp verified</p>
            <p className="mt-1 text-sm text-slate-500">
              {staff.user.whatsappNumber} is verified — you&apos;ll receive WhatsApp notifications for
              time-sensitive items (like an action awaiting your review) at this number.
            </p>
          </Card>
        ) : (
          <VerifyWhatsAppForm initialNumber={staff.user.whatsappNumber} />
        )}
      </div>
    </div>
  );
}

function VerifyWhatsAppForm({ initialNumber }: { initialNumber: string | null }) {
  const [phase, setPhase] = useState<"phone" | "code">("phone");
  const [whatsappNumber, setWhatsappNumber] = useState(initialNumber ?? "");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/birr-staff/me/whatsapp/request-otp", {
        method: "POST",
        body: JSON.stringify({ whatsappNumber }),
      });
      setPhase("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/birr-staff/me/whatsapp/verify-otp", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      // Simplest way to force useStaffSession() to re-fetch /birr-staff/me
      // with the now-verified number — same precedent as the founder
      // onboarding WhatsApp step.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Verify a WhatsApp number to receive time-sensitive notifications there in addition to email and in-app.
      </p>

      {error && (
        <Alert tone="danger" title="Couldn't verify" className="mb-4">
          {error}
        </Alert>
      )}

      {phase === "phone" ? (
        <form onSubmit={handleRequestOtp}>
          <Card>
            <label htmlFor="whatsappNumber" className="mb-1.5 block text-sm font-medium text-slate-700">
              WhatsApp number
            </label>
            <Input
              id="whatsappNumber"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="+15551234567"
              required
            />
            <p className="mt-1.5 text-xs text-slate-500">International format, including the + and country code.</p>
          </Card>
          <div className="mt-6 flex justify-end">
            <Button type="submit" variant="primary" disabled={submitting || whatsappNumber.trim().length === 0}>
              {submitting ? "Sending…" : "Send code"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp}>
          <Card>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-slate-700">
              6-digit code
            </label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              inputMode="numeric"
              required
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Sent to {whatsappNumber} via WhatsApp. Expires in 10 minutes.
            </p>
          </Card>
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setPhase("phone");
                setCode("");
                setError(null);
              }}
              className="text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              ← Use a different number
            </button>
            <Button type="submit" variant="primary" disabled={submitting || code.trim().length === 0}>
              {submitting ? "Verifying…" : "Verify"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
