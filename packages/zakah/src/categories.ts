/** The eight categories of people zakah may go to (Qur'an 9:60), in the verse's order. */
export const ZAKAH_CATEGORIES = [
  "fuqara",
  "masakin",
  "amilin",
  "muallafah",
  "riqab",
  "gharimin",
  "fi_sabilillah",
  "ibn_sabil",
] as const;

export type ZakahCategoryKey = (typeof ZAKAH_CATEGORIES)[number];

export const ZAKAH_CATEGORY_LABELS: Record<ZakahCategoryKey, string> = {
  fuqara: "the poor (al-fuqara)",
  masakin: "the needy (al-masakin)",
  amilin: "zakah administrators (al-'amilin)",
  muallafah: "those whose hearts are to be reconciled (al-mu'allafah qulubuhum)",
  riqab: "freeing those in bondage (fi al-riqab)",
  gharimin: "those in debt (al-gharimin)",
  fi_sabilillah: "in the cause of Allah (fi sabilillah)",
  ibn_sabil: "the stranded traveller (ibn al-sabil)",
};

/**
 * Closed to payment: 100% of zakah reaches recipients (owner's decision,
 * 2026-11-11), so Birr takes no administrators' share. The backend and a
 * database CHECK enforce this; the apps use it to leave the option out.
 */
export const CLOSED_ZAKAH_CATEGORIES: readonly ZakahCategoryKey[] = ["amilin"];
