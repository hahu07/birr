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
export function humanizePermissionKey(key: string): string {
  return key
    .split(".")
    .filter(Boolean)
    .map((segment) => humanize(segment))
    .join(" · ");
}

/** Thousands-separated display for a Decimal-as-string monetary amount, e.g. "125000" -> "125,000". */
export function formatAmount(amount: string | number): string {
  return Number(amount).toLocaleString();
}

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
