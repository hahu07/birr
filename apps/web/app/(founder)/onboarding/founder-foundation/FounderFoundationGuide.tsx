// Reference panel next to the Founder & Foundation establishment step —
// "Founder type" and "Institution type" are the two fields most likely to
// confuse a first-time founder (per CLAUDE.md: a Founder can be a bank,
// university, family office, NGO, government, awqaf authority, or an
// individual). Plain-language description + a concrete example per
// option, not legal guidance — just enough to help someone recognize
// which one matches who they actually are.
//
// 2026-11-14 redesign: the founder-type picker is now a pair of cards
// carrying each type's one-line description (like the Waqf Fund step's
// type cards), so this panel explains only the current choices, the same
// way WaqfTypeGuide does, instead of listing every option.
import { IconCheckCircle } from "@birr/ui";

export type FounderKind = "institution" | "individual";
export type InstitutionType =
  | "islamic_bank"
  | "university"
  | "corporate_foundation"
  | "ngo"
  | "family_office"
  | "government"
  | "awqaf_authority"
  | "other";

export const KIND_GUIDE: Record<FounderKind, { label: string; description: string; example: string }> = {
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

export const INSTITUTION_TYPE_GUIDE: Record<InstitutionType, { label: string; example: string }> = {
  islamic_bank: { label: "Islamic Bank", example: "A bank dedicating a share of profits under its Shariah-compliant CSR mandate." },
  university: { label: "University", example: "A university endowing scholarship funds for underprivileged students." },
  corporate_foundation: { label: "Corporate Foundation", example: "A company's dedicated charitable foundation entity, separate from its main business." },
  ngo: { label: "NGO", example: "A humanitarian or development NGO converting part of its reserves into a permanent endowment." },
  family_office: { label: "Family Office", example: "A wealthy family's office establishing a multi-generational charitable endowment." },
  government: { label: "Government", example: "A government agency or ministry dedicating public land or funds as waqf." },
  awqaf_authority: { label: "Awqaf Authority", example: "A national or state waqf regulatory body establishing a fund it directly administers." },
  other: { label: "Other", example: "Any institution that doesn't fit the categories above." },
};

const NEXT_STEPS = [
  "Your Foundation is established as soon as you submit. There's no approval step.",
  "Birr becomes its Mutawalli (trustee).",
  "Next, you set up and fund your first Waqf Fund.",
];

export function FounderFoundationGuide({ kind, institutionType }: { kind: FounderKind; institutionType: InstitutionType }) {
  const entry = KIND_GUIDE[kind];
  const institution = kind === "institution" ? INSTITUTION_TYPE_GUIDE[institutionType] : null;
  return (
    <aside className="hidden rounded-2xl border border-primary-100 bg-gradient-to-b from-primary-50/80 to-white p-5 shadow-sm lg:sticky lg:top-20 lg:block">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">{entry.label} founders</p>
      <p className="mt-3 text-sm leading-relaxed text-slate-700">{entry.description}</p>
      <p className="mt-3 rounded-xl bg-white/80 p-3 text-xs italic leading-relaxed text-slate-600 ring-1 ring-inset ring-primary-100">
        e.g. {entry.example}
      </p>

      {institution && (
        <div className="mt-5 border-t border-primary-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">{institution.label}</p>
          <p className="mt-2 text-xs italic leading-relaxed text-slate-600">e.g. {institution.example}</p>
        </div>
      )}

      <div className="mt-5 border-t border-primary-100 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">What happens next</p>
        <ul className="mt-3 space-y-2.5">
          {NEXT_STEPS.map((line) => (
            <li key={line} className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
              <IconCheckCircle className="mt-px h-3.5 w-3.5 shrink-0 text-primary-600" />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">A plain-language guide to help you pick — not legal advice.</p>
    </aside>
  );
}
