// Small formatting helpers shared across founder-portal pages: humanizing
// snake_case enum values from the backend (waqf type/status, institution
// type) and consistent date display. Mirrors apps/ops-console/lib/format.ts.

export function humanize(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
