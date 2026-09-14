// Single source of truth for the three WaqfType values (schema.prisma)
// as public-facing content — the marketing home's summary cards and the
// /waqf-types/[slug] detail pages both read from this, so the two
// surfaces can never drift out of sync with each other or with the
// actual enum. No fourth "combined" type: a Founder can already
// establish as many separate Waqf Funds as they like under one
// Foundation, so a fund spanning purposes is just two funds, not a
// distinct type (see CLAUDE.md's 2026-09-03 update).
import { ComponentType, SVGProps } from "react";
import { IconBriefcase, IconLandmark, IconUsers } from "@birr/ui";
import { AssetIllustration, InvestmentIllustration, ProjectIllustration } from "./illustrations";

export type WaqfTypeSlug = "investment" | "asset" | "project";
export const WAQF_TYPE_SLUGS: readonly WaqfTypeSlug[] = ["investment", "asset", "project"];

export interface WaqfTypeContent {
  slug: WaqfTypeSlug;
  label: string;
  /** "a" or "an" — explicit rather than sniffed from label[0], since there are only three of these. */
  article: "a" | "an";
  tagline: string;
  /** Short card copy — the marketing home's summary grid. */
  summary: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  illustration: ComponentType<{ className?: string }>;
  /** Fuller explanation — the detail page's lead paragraph. */
  description: string;
  example: string;
  /** How ongoing, Birr-staff-mediated governance looks for this type specifically. */
  governance: string;
  goodFit: string[];
}

export const WAQF_TYPE_CONTENT: Record<WaqfTypeSlug, WaqfTypeContent> = {
  investment: {
    slug: "investment",
    label: "Investment",
    article: "an",
    tagline: "Corpus invested, income spent — perpetuity by design.",
    summary: "Corpus stays invested — distributable income funds the causes you've allocated it to.",
    icon: IconBriefcase,
    illustration: InvestmentIllustration,
    description:
      "An Investment Waqf Fund puts your endowed corpus to work in a Shariah-compliant portfolio — equities, sukuk, or a managed mandate. The principal is never spent; only the returns it generates are. That's the classical waqf principle of perpetuity, enforced in how the platform tracks money: corpus and investment proceeds are tracked as two separate pools, and only proceeds — the income the corpus generates — ever reach your causes' beneficiaries. Corpus allocation is a preservation target you can still set, never a spending ceiling.",
    example: "A family endows $50,000 into a diversified halal portfolio; the yearly returns fund scholarships indefinitely.",
    governance:
      "Once established, an Investment Fund's portfolio is managed by Birr's Investment Committee under the same maker-checker governance as every other change — placements, proceeds recording, and any reallocation are proposed by one officer and approved by another, never the same person. An investment-research agent may screen holdings for Shariah compliance and flag portfolio drift for the Committee's review, draft-only — it never places a trade or approves a change itself.",
    goodFit: [
      "You want your gift to keep giving indefinitely, not be spent down.",
      "You're comfortable with market-linked returns funding your cause over time, rather than a fixed amount today.",
      "You want the principal itself protected and reported on separately from what it earns.",
    ],
  },
  asset: {
    slug: "asset",
    label: "Asset",
    article: "an",
    tagline: "A physical asset held in trust, for as long as it lasts.",
    summary: "Land, property, or equipment held in trust, managed for lasting benefit.",
    icon: IconLandmark,
    illustration: AssetIllustration,
    description:
      "An Asset Waqf Fund holds a physical, income-producing property directly — the property itself, or the income it generates (rent, usage fees), funds your cause. There's no investment layer: what you endow is what's held, registered, and eventually maintained or disposed of under Birr's oversight, not converted into a portfolio.",
    example: "A donated apartment building whose rental income pays for a mosque's utilities and imam's stipend.",
    governance:
      "Registering, maintaining, or ever disposing of an asset under an Asset Fund goes through the same maker-checker process as any other governed action — no single Birr officer can register or dispose of an asset alone. Every change is written to the immutable audit trail from the moment the asset is registered.",
    goodFit: [
      "You're endowing a specific property or piece of equipment, not liquid capital.",
      "The benefit comes from holding or using the asset itself, not investing its value.",
      "You want a direct, traceable link between the physical asset and the cause it funds.",
    ],
  },
  project: {
    slug: "project",
    label: "Project",
    article: "a",
    tagline: "One initiative, however many Founders stand behind it.",
    summary: "A defined initiative — the one type more than one Founder can establish jointly.",
    icon: IconUsers,
    illustration: ProjectIllustration,
    description:
      "A Project Waqf Fund funds a specific initiative directly — a well-drilling program, a school building, a relief effort — rather than being invested or held as property. It's the one Waqf Fund type more than one Founder can establish jointly, since a shared initiative often has more than one institution or individual behind it from the start.",
    example: "Contributions fund building and running a well-drilling program across rural villages.",
    governance:
      "A Project Fund's own lifecycle — milestones, completion — is tracked directly on the fund, and every distribution toward the initiative goes through the same maker-checker approval as any other type. Joint establishment doesn't mean joint governance: once established, ongoing oversight is Birr-staff-mediated exactly like every other Waqf Fund.",
    goodFit: [
      "You're funding a defined initiative with a clear start and, usually, an end — not an ongoing pool.",
      "More than one Founder or institution wants to stand behind the same initiative together.",
      "The initiative doesn't naturally fit \"invest capital\" or \"hold a property.\"",
    ],
  },
};
