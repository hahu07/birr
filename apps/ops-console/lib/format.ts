// Small formatting helpers shared across ops-console pages: humanizing
// snake_case enum values from the backend (staff roles, assignment roles,
// statuses) and consistent date display.

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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
