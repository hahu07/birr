"use client";

// Invite a co-founder — a brand-new Founder identity (a different
// institution or individual) that will end up with equal, full standing
// on this Foundation once accepted, not a teammate under the CURRENT
// Founder (see team/page.tsx's InviteForm for that, different concept —
// FounderMembership, not FoundationFounder). Structurally mirrors that
// same InviteForm (email -> submit -> emailed/copy-link success state)
// but with no role selector, since the invitee always joins as
// primary_contact of their own new Founder, never a chosen
// FounderPermissionLevel.
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import type { Invitation } from "../../../../lib/types";
import { Alert, Button, Input } from "@birr/ui";

export function InviteCoFounderForm({
  foundationId,
  onInvited,
  onCancel,
}: {
  foundationId: string;
  onInvited: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Invitation | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const invitation = await apiFetchJson<Invitation>("/invitations", {
        method: "POST",
        body: JSON.stringify({ inviteeKind: "co_founder", email: email.trim(), foundationId }),
      });
      setSent(invitation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/ops/accept-invitation?token=${sent.token}&kind=co_founder`;
    return (
      <div className="mb-6 rounded-lg border border-primary-200 bg-primary-50 p-4">
        {sent.emailSent ? (
          <p className="text-sm font-medium text-primary-900">Invitation emailed to {sent.email}.</p>
        ) : (
          <>
            <p className="text-sm font-medium text-primary-900">
              Couldn&apos;t send the email automatically — copy this link and send it to {sent.email} yourself:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-primary-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
                {link}
              </code>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => navigator.clipboard.writeText(link)}>
                Copy
              </Button>
            </div>
          </>
        )}
        <div className="mt-3">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={onInvited}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't send invitation">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Email</label>
          <Input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="co-founder@example.com"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send invite"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        They&apos;ll create their own Founder identity and gain full, equal access to this Foundation — including
        everything already established under it.
      </p>
    </form>
  );
}
