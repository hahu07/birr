// Shared status styling + grouping logic for the Overview (compact
// summary) and Portfolio (full list + detail) pages — both derive their
// view from the same `GET /waqfs` response, just at different levels of
// detail, so the status vocabulary and Foundation-grouping stay in one
// place rather than drifting between the two pages.
import { IconArchive, IconCheckCircle, IconClock, IconXCircle } from "@birr/ui";
import type { Foundation, Waqf } from "./types";

export const STATUS_TONE: Record<Waqf["status"], "success" | "neutral" | "warning" | "danger"> = {
  active: "success",
  draft: "neutral",
  suspended: "warning",
  dissolved: "danger",
};

// StatCard's tone palette is a subset of Badge's (no "danger") — this is
// a calm supporting strip, not a warning surface, so "suspended" and
// "dissolved" read as neutral/attention rather than alarming here.
export const STATUS_STAT_TONE: Record<Waqf["status"], "neutral" | "primary" | "success" | "warning"> = {
  active: "success",
  draft: "neutral",
  suspended: "warning",
  dissolved: "neutral",
};

export const STATUS_ICON: Record<Waqf["status"], typeof IconCheckCircle> = {
  active: IconCheckCircle,
  draft: IconClock,
  suspended: IconXCircle,
  dissolved: IconArchive,
};

// Mercury-style texture: a status-colored left border plus a matching
// icon badge, so status reads at a glance from a card's silhouette, not
// only from the corner pill.
export const STATUS_BORDER: Record<Waqf["status"], string> = {
  active: "border-l-primary-500",
  draft: "border-l-slate-300",
  suspended: "border-l-accent-500",
  dissolved: "border-l-red-300",
};

export const STATUS_BADGE_BG: Record<Waqf["status"], string> = {
  active: "bg-primary-50 text-primary-700",
  draft: "bg-slate-100 text-slate-500",
  suspended: "bg-accent-100 text-accent-600",
  dissolved: "bg-red-50 text-red-500",
};

export function countByStatus(waqfs: Waqf[]): Partial<Record<Waqf["status"], number>> {
  const counts: Partial<Record<Waqf["status"], number>> = {};
  for (const waqf of waqfs) {
    counts[waqf.status] = (counts[waqf.status] ?? 0) + 1;
  }
  return counts;
}

export interface FoundationGroup {
  foundation: Foundation;
  waqfs: Waqf[];
}

// Groups preserve the order Foundations first appear in the `/waqfs`
// response — no independent sort, since the API's own ordering already
// reflects what the backend considers the natural order.
export function groupByFoundation(waqfs: Waqf[]): FoundationGroup[] {
  const groups = new Map<string, FoundationGroup>();
  for (const waqf of waqfs) {
    const existing = groups.get(waqf.foundation.id);
    if (existing) {
      existing.waqfs.push(waqf);
    } else {
      groups.set(waqf.foundation.id, { foundation: waqf.foundation, waqfs: [waqf] });
    }
  }
  return Array.from(groups.values());
}
