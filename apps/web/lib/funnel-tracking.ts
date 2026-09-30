// Lightweight, best-effort beacons for the two acquisition funnels'
// pre-conversion steps — the ones with no database row of their own yet
// (a page view, a checkout started). Real milestones (signup completed,
// foundation created, deed signed, waqf fund created, a vault
// contribution initiated/confirmed) are recorded server-side instead,
// directly by the backend service that already performs that write —
// see FunnelEvent's own schema comment (packages/db/prisma/schema.prisma)
// for the full picture. Never throws, never blocks the caller: a
// blocked or failed analytics beacon must never surface to the visitor.
import { apiFetch } from "./api";

export type FunnelName = "founder" | "vault";

const SESSION_STORAGE_KEY = "birr_funnel_session_id";

function getOrCreateSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    // Private browsing, or storage otherwise blocked — this event still
    // counts toward the funnel total, just without cross-step
    // correlation for this visitor.
    return crypto.randomUUID();
  }
}

export function trackFunnelEvent(
  funnel: FunnelName,
  step: string,
  options?: { vaultId?: string; metadata?: Record<string, unknown> },
): void {
  if (typeof window === "undefined") return;
  apiFetch("/funnel-events", {
    method: "POST",
    body: JSON.stringify({
      funnel,
      step,
      sessionId: getOrCreateSessionId(),
      vaultId: options?.vaultId,
      metadata: options?.metadata,
    }),
  }).catch(() => {
    // Best-effort — see this file's own top comment.
  });
}
