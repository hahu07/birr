// Small formatting helpers shared across both the founder-facing and
// /ops route groups: humanizing snake_case enum values from the backend
// (waqf type/status, institution type, staff roles, assignment roles)
// and consistent date display.

export function humanize(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Humanizes a permission key (e.g. "waqf.create",
 * "beneficiary.criteria_update") into end-user-facing text
 * (e.g. "Waqf · Create", "Beneficiary · Criteria Update").
 *
 * `permission.description` is internal seed-data commentary written for
 * engineers (it references things like CLAUDE.md and internal AI-agent
 * nicknames) and must never be shown to Birr staff — this derives a
 * presentable label from the stable `key` instead.
 */
/** A staff member's roles as one label, e.g. "Legal Adviser, Compliance Officer". */
export function humanizeRoles(roles: readonly string[]): string {
  return roles.map(humanize).join(", ");
}

export function humanizePermissionKey(key: string): string {
  return key
    .split(".")
    .filter(Boolean)
    .map((segment) => humanize(segment))
    .join(" · ");
}

/** Currency-style display for a Decimal-as-string monetary amount, e.g. "125000" -> "125,000.00". */
export function formatAmount(amount: string | number): string {
  return Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Shared between app/(founder)/DashboardOverview.tsx and app/ops/page.tsx's
// waqf-status donut charts — both used to define this map locally with a
// comment admitting they were "kept in sync by convention, not shared
// import." String-literal keys (not either app's own Waqf type) so this
// stays a plain presentational constant, not a cross-route-group type
// dependency.
export const WAQF_STATUS_CHART_COLOR: Record<"active" | "draft" | "suspended" | "dissolved", string> = {
  active: "var(--color-primary-600)",
  draft: "#94a3b8",
  suspended: "var(--color-accent-500)",
  dissolved: "#475569",
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "3m ago" / "5h ago" / "2d ago", falling back to formatDate beyond a week — for notification lists. */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(iso);
}

/**
 * Humanizes a founder's kind/institutionType into a single presentable
 * label — e.g. "Islamic Bank", "University", or "Individual Founder" for
 * individual founders (who have no institutionType on file).
 */
export function describeFounderKind(founder: { kind: string; institutionType: string | null }): string {
  if (founder.kind === "individual") return "Individual Founder";
  return founder.institutionType ? humanize(founder.institutionType) : humanize(founder.kind);
}

// Nicknames from CLAUDE.md's Agentic AI section — internal branding, not
// derived from anything the API returns. Shared by the AI Agents registry
// page and anywhere an ai_agents row needs to be shown by name (e.g. the
// Approvals queue's maker identity) so a given agent reads the same way
// everywhere. Falls back to the raw registry name for any agent not
// listed here.
const AGENT_NICKNAMES: Record<string, string> = {
  rasid: "Rasid — the observer",
  nazim: "Nazim — the organizer",
  kashif: "Kashif — the revealer",
  rashid: "Rashid — the wise",
  rafiq: "Rafiq — the companion",
  munsif: "Munsif — the fair one",
  bashir: "Bashir — the herald",
};

export function agentNickname(registryName: string): string {
  return AGENT_NICKNAMES[registryName] ?? registryName;
}

/**
 * Money with its currency symbol — "₦1,500,000.00", "$2,000.00" — for
 * the Founder Portal's redesigned surfaces. en-NG locale, so naira
 * renders as "₦" (Birr's home currency), not "NGN". Non-ISO codes Intl
 * rejects (USDC/USDT stablecoins) fall back to "USDC 2,000.00".
 * `decimals: 0` for headline figures where kobo is noise.
 */
export function formatMoney(amount: string | number, currency: string, { decimals = 2 }: { decimals?: 0 | 2 } = {}): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-NG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  }
}

// Plain-English labels for the audit actions a Founder's own team can
// trigger (GET /audit-logs/me is scoped to actorFounderId) — the raw
// codes ("waqf_cause.allocation_set") were shown verbatim before. An
// unknown code still renders, via the same humanizer permission keys use.
const AUDIT_ACTION_LABEL: Record<string, string> = {
  "user.signed_up": "Created an account",
  "user.email_verified": "Verified email address",
  "user.whatsapp_verified": "Verified WhatsApp number",
  "user.password_reset": "Reset password",
  "founder.created": "Registered as a Founder",
  "founder.mfa_enabled": "Turned on two-factor authentication",
  "founder.mfa_reset": "Reset two-factor authentication",
  "foundation.created": "Established a Foundation",
  "foundation_deed.signed": "Signed the Foundation Deed",
  "waqf.created": "Established a Waqf Fund",
  "waqf.activated": "Waqf Fund became active",
  "waqf.corpus_target_increased": "Raised a fund's corpus target",
  "contribution.initiated": "Started a contribution",
  "contribution.confirmed": "Contribution confirmed",
  "contribution.failed": "Contribution failed",
  "waqf_cause.selected": "Selected a cause",
  "waqf_cause.unselected": "Removed a cause",
  "waqf_cause.created": "Added a cause",
  "waqf_cause.allocated": "Allocated funds to a cause",
  "waqf_cause.allocation_set": "Allocated funds to a cause",
  "cause_category_suggestion.proposed": "Suggested a new cause category",
  "beneficiary_nomination.proposed": "Nominated a beneficiary",
  "founder_request.created": "Sent a request to Birr",
  "invitation.sent": "Invited a team member",
  "invitation.accepted": "Accepted an invitation",
  "invitation.revoked": "Revoked an invitation",
};

export function describeAuditAction(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? humanizePermissionKey(action);
}
