// Reference panel next to the Founder & Foundation establishment step —
// "Founder type" and "Institution type" are the two fields most likely to
// confuse a first-time founder (per CLAUDE.md: a Founder can be a bank,
// university, family office, NGO, government, awqaf authority, or an
// individual). Plain-language description + a concrete example per
// option, not legal guidance — just enough to help someone recognize
// which one matches who they actually are.
import { Card } from "@birr/ui";

type FounderKind = "institution" | "individual";
type InstitutionType =
  | "islamic_bank"
  | "university"
  | "corporate_foundation"
  | "ngo"
  | "family_office"
  | "government"
  | "awqaf_authority"
  | "other";

const KIND_GUIDE: Record<FounderKind, { label: string; description: string; example: string }> = {
  institution: {
    label: "Institution",
    description: "You're establishing this on behalf of an organization, not yourself personally.",
    example: "A bank's CSR arm, a university endowment office, or an NGO dedicating part of its reserves.",
  },
  individual: {
    label: "Individual",
    description: "You're establishing this in your own personal capacity, not on behalf of an organization.",
    example: "A person dedicating part of their personal savings or an inherited property as waqf.",
  },
};

const INSTITUTION_TYPE_GUIDE: Record<InstitutionType, { label: string; example: string }> = {
  islamic_bank: { label: "Islamic Bank", example: "A bank dedicating a share of profits under its Shariah-compliant CSR mandate." },
  university: { label: "University", example: "A university endowing scholarship funds for underprivileged students." },
  corporate_foundation: { label: "Corporate Foundation", example: "A company's dedicated charitable foundation entity, separate from its main business." },
  ngo: { label: "NGO", example: "A humanitarian or development NGO converting part of its reserves into a permanent endowment." },
  family_office: { label: "Family Office", example: "A wealthy family's office establishing a multi-generational charitable endowment." },
  government: { label: "Government", example: "A government agency or ministry dedicating public land or funds as waqf." },
  awqaf_authority: { label: "Awqaf Authority", example: "A national or state waqf regulatory body establishing a fund it directly administers." },
  other: { label: "Other", example: "Any institution that doesn't fit the categories above." },
};

export function FounderFoundationGuide({
  kind,
  institutionType,
}: {
  kind: FounderKind;
  institutionType: InstitutionType;
}) {
  return (
    <Card className="lg:sticky lg:top-6">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Founder type explained</p>
      <p className="mb-3 text-xs text-slate-500">Not legal advice — just a plain-language guide to help you pick.</p>
      <div className="space-y-3">
        {(Object.keys(KIND_GUIDE) as FounderKind[]).map((key) => {
          const isSelected = key === kind;
          const entry = KIND_GUIDE[key];
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

      {kind === "institution" && (
        <>
          <p className="mb-1 mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">Institution type</p>
          <div className="space-y-2">
            {(Object.keys(INSTITUTION_TYPE_GUIDE) as InstitutionType[]).map((key) => {
              const isSelected = key === institutionType;
              const entry = INSTITUTION_TYPE_GUIDE[key];
              return (
                <div
                  key={key}
                  className={`rounded-md border p-2.5 transition-colors ${
                    isSelected ? "border-primary-300 bg-primary-50" : "border-slate-100"
                  }`}
                >
                  <p className={`text-xs font-semibold ${isSelected ? "text-primary-900" : "text-slate-700"}`}>
                    {entry.label}
                  </p>
                  <p className="mt-0.5 text-xs italic leading-relaxed text-slate-500">e.g. {entry.example}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
