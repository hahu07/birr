// Reference panel next to the Waqf Fund establishment form — the three
// WaqfType values (schema.prisma) are Islamic-finance jargon a
// first-time founder shouldn't be expected to already know. Plain-
// language description + a concrete example per type, not legal or
// Shariah guidance — just enough to help a founder recognize which one
// matches what they actually have in mind.
import { Card } from "@birr/ui";

type WaqfType = "investment" | "asset" | "project";

const TYPE_GUIDE: Record<WaqfType, { label: string; description: string; example: string }> = {
  investment: {
    label: "Investment",
    description:
      "The corpus is invested (e.g. Shariah-compliant equities, sukuk, a managed portfolio) — the returns fund your cause over time, while the principal stays intact.",
    example: "A family endows $50,000 into a diversified halal portfolio; the yearly returns fund scholarships indefinitely.",
  },
  asset: {
    label: "Asset",
    description:
      "The corpus is a physical, income-producing property held directly — the property itself, or the income it generates, funds your cause.",
    example: "A donated apartment building whose rental income pays for a mosque's utilities and imam's stipend.",
  },
  project: {
    label: "Project",
    description: "The corpus funds a specific initiative directly, rather than being invested or held as property.",
    example: "Contributions fund building and running a well-drilling program across rural villages.",
  },
};

export function WaqfTypeGuide({ selected }: { selected: WaqfType }) {
  return (
    <Card className="lg:sticky lg:top-6">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Waqf types explained</p>
      <p className="mb-3 text-xs text-slate-500">Not legal or Shariah advice — just a plain-language guide to help you pick.</p>
      <div className="space-y-3">
        {(Object.keys(TYPE_GUIDE) as WaqfType[]).map((key) => {
          const isSelected = key === selected;
          const entry = TYPE_GUIDE[key];
          return (
            <div
              key={key}
              className={`rounded-md border p-3 transition-colors ${
                isSelected ? "border-primary-300 bg-primary-50" : "border-slate-100"
              }`}
            >
              <p className={`text-sm font-semibold ${isSelected ? "text-primary-900" : "text-slate-700"}`}>
                {entry.label}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{entry.description}</p>
              <p className="mt-1.5 text-xs italic leading-relaxed text-slate-500">e.g. {entry.example}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
