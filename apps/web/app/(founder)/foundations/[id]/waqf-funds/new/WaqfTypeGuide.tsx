// Reference panel next to the Waqf Fund establishment form — the three
// WaqfType values (schema.prisma) are Islamic-finance jargon a
// first-time founder shouldn't be expected to already know. Plain-
// language description + a concrete example per type, not legal or
// Shariah guidance — just enough to help a founder recognize which one
// matches what they actually have in mind.
type WaqfType = "investment" | "asset" | "project";

export const TYPE_GUIDE: Record<WaqfType, { label: string; summary: string; description: string; example: string }> = {
  investment: {
    label: "Investment",
    summary: "Invested — only the returns are spent",
    description:
      "The corpus is invested (e.g. Shariah-compliant equities, sukuk, a managed portfolio) — the returns fund your cause over time, while the principal stays intact.",
    example: "A family endows ₦50 million into a diversified halal portfolio; the yearly returns fund scholarships indefinitely.",
  },
  asset: {
    label: "Asset",
    summary: "Income-producing property held directly",
    description:
      "The corpus is a physical, income-producing property held directly — the property itself, or the income it generates, funds your cause.",
    example: "A donated apartment building whose rental income pays for a mosque's utilities and imam's stipend.",
  },
  project: {
    label: "Project",
    summary: "Funds a specific initiative directly",
    description: "The corpus funds a specific initiative directly, rather than being invested or held as property.",
    example: "Contributions fund building and running a well-drilling program across rural villages.",
  },
};

/**
 * The selected type, explained in full — sits beside the form (sticky on
 * desktop) now that the type picker itself is a set of cards carrying
 * each type's one-line summary.
 */
export function WaqfTypeGuide({ selected }: { selected: WaqfType }) {
  const entry = TYPE_GUIDE[selected];
  return (
    <aside className="hidden rounded-2xl border border-primary-100 bg-gradient-to-b from-primary-50/80 to-white p-5 shadow-sm lg:sticky lg:top-20 lg:block">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">About {entry.label} funds</p>
      <p className="mt-3 text-sm leading-relaxed text-slate-700">{entry.description}</p>
      <p className="mt-3 rounded-xl bg-white/80 p-3 text-xs italic leading-relaxed text-slate-600 ring-1 ring-inset ring-primary-100">
        e.g. {entry.example}
      </p>
      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        A plain-language guide to help you pick — not legal or Shariah advice.
      </p>
    </aside>
  );
}
