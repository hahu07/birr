"use client";

// Public landing page — the signed-out counterpart rendered at "/" by
// page.tsx (see app-shell.tsx's HOME_ROUTE handling: this is the one
// route that's public-or-private depending on session, not purely one
// or the other). No Founder Portal chrome — a first-time visitor hasn't
// signed up yet, so every fact on this page has to stand on its own,
// not lean on nav/context that only exists once signed in.
//
// 2026-10 redesign: the hero leads with the product itself (the Founder
// Portal overview on a desktop monitor, sample data), and the two products
// are laid side by side rather than behind tabs. Copy stays to what the
// platform actually enforces — "dual authorisation" rather than "Board
// approval", because a payout's checker may be a Board member or a
// Compliance Officer; "Shariah advisory" is the owner's chosen public name.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  IconArrowRight,
  IconCheckCircle,
  IconFileText,
  IconGlobe,
  IconLandmark,
  IconShieldCheck,
  IconSparkle,
  IconUsers,
} from "@birr/ui";
import { apiFetchJson } from "../../lib/api";
import type { ArticleSummary } from "../../lib/blog-meta";
import type { FieldPhoto, ImpactSummary } from "../../lib/impact-api";
import { ImpactSection } from "./ImpactSection";
import type { Vault } from "../../lib/types";
import { ArticleCard } from "../../components/blog/ArticleCard";
import { GRADIENT, Reveal, SiteFooter, SiteHeader, VaultCard } from "./SiteChrome";
import { WAQF_TYPE_CONTENT, WAQF_TYPE_SLUGS, type WaqfTypeSlug } from "./waqf-types/content";
import { GeometricPattern } from "./_components/ui";
import { DashboardMockup, HeroMonitor } from "./_components/DashboardMockup";

// The three Waqf Fund types — label/summary/icon come from WAQF_TYPE_CONTENT
// (waqf-types/content.ts), shared with the /waqf-types/[slug] pages each
// card links to, so the two can't drift apart. The classical category and
// a worked example are homepage-only additions.
const WAQF_TYPES = WAQF_TYPE_SLUGS.map((slug) => WAQF_TYPE_CONTENT[slug]);
const WAQF_TYPE_EXTRA: Record<WaqfTypeSlug, { classical: string; example: string }> = {
  investment: {
    classical: "waqf istithmari",
    example: "₦20,000,000 endowed and never touched — its returns paying school fees, year after year.",
  },
  asset: {
    classical: "istithmari or mubashir",
    example: "A shop building whose rent meets a clinic's running costs, or a borehole a community draws on.",
  },
  project: {
    classical: "developmental",
    example: "Several families, as co-founders of one Foundation, endowing a maternity clinic together.",
  },
};

// The homepage stays a teaser, not a duplicate of the dedicated /vaults
// index — cap it here and point to that page for the rest.
const VAULT_TEASER_LIMIT = 3;

const TRUST_POINTS = [
  { icon: IconLandmark, title: "Registered trustee", body: "Incorporated Trustee under the Corporate Affairs Commission" },
  { icon: IconShieldCheck, title: "Shariah advisory", body: "Investments screened against prohibited sectors" },
  { icon: IconUsers, title: "Dual authorisation", body: "Every payout approved by a second person" },
  { icon: IconFileText, title: "Permanent record", body: "Every action logged — nothing edited or deleted" },
];

const GOVERNANCE_POINTS = [
  {
    id: undefined,
    icon: IconUsers,
    title: "Dual authorisation on every consequential act",
    body: "Distributions, investment changes, asset disposals and beneficiary criteria each need two different people. The system itself refuses an approval by the person who proposed it.",
  },
  {
    id: undefined,
    icon: IconLandmark,
    title: "Separated duties",
    body: "Board of Trustees, Shariah advisory, Investment and Audit Committees, Risk & Compliance — distinct roles, each with defined authority.",
  },
  {
    id: undefined,
    icon: IconFileText,
    title: "An audit trail no one can edit",
    body: "Who acted, when, and what changed — append-only, including for the people who run Birr.",
  },
  {
    id: undefined,
    icon: IconGlobe,
    title: "Jurisdiction-aware compliance",
    body: "Each waqf is governed by the requirements of its own jurisdiction, aligned with AAOIFI and IFSB principles — not one policy applied everywhere.",
  },
  {
    // Keeps the old "/#ai" anchor working now that AI has no section of its own.
    id: "ai",
    icon: IconSparkle,
    title: "AI that advises, never approves",
    body: "AI agents may draft, flag and monitor. There is no field in the system for an AI approval — a named person decides.",
  },
];

// Answers to the objections a first-time visitor actually has, each one
// grounded in what the platform enforces — never a claim invented here.
const FAQ_ITEMS = [
  {
    question: "Do I need approval to establish a Waqf Fund?",
    answer:
      "No. Establishing your Foundation and Waqf Fund is entirely self-service — no application, no waiting period, no Birr staff involved. Creating the fund is itself how you agree Birr becomes Mutawalli (trustee) over it.",
  },
  {
    question: 'What is Sadaqah Jariyah, and how does Birr "prove" it?',
    answer:
      "Sadaqah Jariyah is ongoing charity — a gift that keeps benefiting others, and keeps earning reward, long after you give it. Birr proves that continuity the same way it proves every other governed decision: every asset, distribution and investment change is written to an immutable, append-only audit trail from the moment your Waqf Fund is established.",
  },
  {
    question: "Who manages my Waqf Fund once it's established?",
    answer:
      "Ongoing governance — asset disposal, distribution approval, investment changes — moves to Birr's own staff under dual authorisation: every action is proposed by one person and approved by a different one, enforced by the database itself, not just policy. You keep the purpose — which causes it supports and how its endowment is earmarked between them.",
  },
  {
    question: "What's the difference between a Waqf Fund and a Vault?",
    answer:
      "A Waqf Fund is an endowment you establish; its corpus is preserved and Birr becomes its trustee. A Vault is a Birr-curated campaign anyone can give to, with no account needed; the gift is spent on the need it was given for. Both run under the same dual authorisation once money moves.",
  },
  {
    question: "How is Shariah compliance ensured?",
    answer:
      "Shariah advisory sits alongside Birr's other governance roles, every investment is screened against prohibited sectors before it's placed, and for an Investment Waqf the system refuses any distribution drawn from the corpus itself.",
  },
  {
    question: "Is establishing a waqf the same as paying zakat?",
    answer: "No. Zakat is an obligation on wealth with its own recipients, and establishing a waqf does not discharge it. The two are separate acts.",
  },
  {
    question: "Is my gift's use ever a black box?",
    answer:
      "No — every governed action on your Waqf Fund, or on a Vault you've given to, is recorded permanently: who acted, when, and what changed. That trail can't be edited or deleted after the fact, by design.",
  },
];

export default function MarketingHome({
  articles = [],
  impact = null,
  impactPhotos = [],
}: {
  articles?: ArticleSummary[];
  impact?: ImpactSummary | null;
  impactPhotos?: FieldPhoto[];
}) {
  // Real data, not a placeholder — GET /vaults/open is @Public(), no
  // session needed, and each vault's causes come embedded in the response.
  const [openVaults, setOpenVaults] = useState<Vault[] | null>(null);
  // On a fetch failure openVaults deliberately stays null rather than []
  // — the hero badge and empty-state copy treat null as "nothing to show
  // yet", which is honest (unlike claiming zero vaults are open).
  const [vaultsLoadError, setVaultsLoadError] = useState(false);

  useEffect(() => {
    apiFetchJson<Vault[]>("/vaults/open")
      .then(setOpenVaults)
      .catch(() => setVaultsLoadError(true));
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader tone="dark" />

      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden px-6 pb-16 sm:px-8 lg:pb-14">
        <div className="absolute inset-0 overflow-hidden" style={{ backgroundImage: GRADIENT }} aria-hidden="true">
          <GeometricPattern className="absolute inset-0 h-full w-full text-accent-400/[0.13] [mask-image:linear-gradient(to_bottom,black,rgba(0,0,0,0.45))]" />
          <div className="absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary-500/20 blur-3xl" />
        </div>

        <div className="relative mx-auto grid max-w-7xl items-center gap-14 pt-12 sm:pt-16 lg:grid-cols-2 lg:pt-12 lg:gap-12 xl:gap-16">
          <div className="text-center lg:text-left">
            {/* A live figure, not a decorative label — falls back to a
                plain category pill until openVaults has loaded, or if
                nothing's open, so it never flashes a deflating "0". */}
            <p className="inline-flex items-center gap-2.5 rounded-full border border-accent-200/30 bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-accent-200">
              {openVaults && openVaults.length > 0 ? (
                <>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-300 shadow-[0_0_0_4px_rgba(120,203,178,0.18)]" aria-hidden="true" />
                  {openVaults.length} {openVaults.length === 1 ? "vault" : "vaults"} open for giving now
                </>
              ) : (
                "Digital trustee for Islamic waqf"
              )}
            </p>
            <h1 className="mt-6 font-display text-[2.6rem] font-medium leading-[1.04] tracking-tight text-white text-balance sm:text-6xl xl:text-[4.25rem]">
              A gift that outlives you.
              <span className="mt-4 block text-[0.6em] font-normal italic leading-[1.15] text-accent-300">
                Sadaqah Jariyah, engineered to prove it.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-primary-100/85 text-pretty sm:text-lg lg:mx-0">
              Establish your own Waqf Fund in minutes. Birr becomes your Mutawalli — investing, distributing and reporting under dual
              authorisation and an audit trail no one can edit.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center rounded-xl bg-accent-500 px-6 py-3.5 text-base font-semibold text-primary-950 shadow-lg shadow-accent-900/30 transition-colors hover:bg-accent-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
              >
                Establish your Waqf Fund
              </Link>
              <Link
                href="/vaults"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/25 bg-white/[0.04] px-6 py-3.5 text-base font-semibold text-white transition-colors hover:border-white/50 hover:bg-white/10"
              >
                Support a cause <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-primary-200 lg:justify-start">
              {["CAC-registered trustee", "Shariah advisory", "Dual authorisation"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <IconCheckCircle className="h-4 w-4 text-accent-300" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="mx-auto w-full max-w-[560px] xl:max-w-[600px]">
            <div className="relative">
              <FloatingNote
                className="-left-8 bottom-[4%]"
                tone="primary"
                title="Distribution approved"
                line="₦620,000 to Education"
                note="Proposed by one officer, approved by another"
                icon={<IconCheckCircle className="h-4 w-4" />}
              />
              <FloatingNote
                className="-right-6 bottom-[4%]"
                tone="accent"
                title="Corpus preserved"
                line="₦25,000,000 Investment Waqf"
                note="Only its returns are ever distributed"
                icon={<IconShieldCheck className="h-4 w-4" />}
              />
              <HeroMonitor>
                <DashboardMockup />
              </HeroMonitor>
            </div>
            <p className="mt-4 text-center text-xs text-primary-200/70 sm:text-sm">
              The Founder Portal, shown with sample data.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- Trust strip ---------------- */}
      <section aria-label="Why founders trust Birr" className="border-y border-slate-200/80 px-6 sm:px-8">
        <ul className="mx-auto grid max-w-6xl sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_POINTS.map((p, i) => (
            <li
              key={p.title}
              className={`flex gap-3.5 py-7 sm:px-6 ${i > 0 ? "border-t border-slate-200/80 sm:border-t-0" : ""} ${
                i % 2 === 1 ? "sm:border-l sm:border-slate-200/80" : ""
              } ${i === 2 ? "lg:border-l lg:border-slate-200/80" : ""} ${i >= 2 ? "sm:border-t sm:border-slate-200/80 lg:border-t-0" : ""}`}
            >
              <p.icon className="mt-0.5 h-[22px] w-[22px] shrink-0 text-accent-600" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{p.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------- Two ways to give ---------------- */}
      <section id="how-it-works" className="px-6 py-16 sm:px-8 lg:py-16">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="Two ways to give"
            split
            title="One trustee. Two very different gifts."
            lead="Establish an endowment that keeps giving for generations, or give today to a need Birr has already vetted. They are deliberately kept apart — one is not a smaller version of the other."
          />
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <article className="relative flex h-full flex-col overflow-hidden rounded-3xl p-7 text-white sm:p-8" style={{ backgroundImage: GRADIENT }}>
                <GeometricPattern className="pointer-events-none absolute inset-0 h-full w-full text-accent-400/[0.1] [mask-image:linear-gradient(200deg,black,transparent_70%)]" />
                <div className="relative flex flex-1 flex-col">
                  <span className="self-start rounded-full border border-accent-200/30 bg-accent-200/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-accent-200">
                    For founders
                  </span>
                  <h3 className="mt-4 font-display text-[1.75rem] font-medium tracking-tight">Establish your own Waqf Fund</h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-primary-100/85">
                    For individuals, families and institutions. You set up your Foundation and Waqf Fund yourself — creating it is what
                    appoints Birr as your Mutawalli.
                  </p>
                  <CheckList
                    tone="dark"
                    items={["Self-service, with no approval gate", "One signed deed covers every fund you add later", "Built to keep giving long after you"]}
                  />
                  <Link
                    href="/sign-up"
                    className="mt-6 inline-flex self-start rounded-xl bg-accent-500 px-5 py-3 text-sm font-semibold text-primary-950 transition-colors hover:bg-accent-300"
                  >
                    Establish your Waqf Fund
                  </Link>
                </div>
              </article>
            </Reveal>
            <Reveal delayMs={90}>
              <article className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-7 sm:p-8">
                <span className="self-start rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary-700">
                  For everyone
                </span>
                <h3 className="mt-4 font-display text-[1.75rem] font-medium tracking-tight text-slate-900">Give through a Vault</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-slate-600">
                  Campaigns curated by Birr around a defined need. Anyone can give — no account, no paperwork — and every gift is traced
                  to the partner who delivers it.
                </p>
                <CheckList
                  tone="light"
                  items={["Pay in naira by card or transfer", "Several causes per campaign, each shown separately", "Results posted publicly against each cause"]}
                />
                <Link
                  href="/vaults"
                  className="mt-6 inline-flex self-start rounded-xl bg-primary-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-800"
                >
                  See open Vaults
                </Link>
              </article>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- What a waqf is ---------------- */}
      <section className="bg-slate-50/80 px-6 py-16 sm:px-8 lg:py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHead
              kicker="What a waqf is"
              title="Give once. It keeps giving."
              lead="A waqf is a permanent charitable endowment. The corpus is set aside and never spent — only what it produces is given away, for as long as the endowment lasts."
            />
            <dl className="mt-7 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {[
                ["The founder", "waqif", "The person or institution that endows it."],
                ["The corpus", "mawquf", "The endowment itself, preserved for good."],
                ["The beneficiaries", "mawquf alayh", "Those the waqf is created to serve."],
                ["The trustee", "mutawalli", "The role Birr takes on — never the owner."],
              ].map(([term, arabic, def]) => (
                <div key={term}>
                  <dt className="text-sm font-semibold text-slate-900">
                    {term} <span className="ml-1 font-display font-normal italic text-accent-700">{arabic}</span>
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-slate-600">{def}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Reveal>
            <figure className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_30px_60px_-40px_rgba(8,39,32,0.35)] sm:p-7">
              <WaqfDiagram />
              <figcaption className="mt-4 text-sm italic text-slate-500">The same diagram founders find in the Waqf Founder's Handbook.</figcaption>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Three kinds of waqf fund ---------------- */}
      <section id="waqf-types" className="px-6 py-16 sm:px-8 lg:py-16">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="Waqf funds"
            split
            title="Choose the kind of waqf fund."
            lead="The type decides what is preserved and what is spent. Your Mutawalli Officer helps you choose before anything is signed."
          />
          <div className="mt-9 grid gap-6 md:grid-cols-3">
            {WAQF_TYPES.map((type, i) => (
              <Reveal key={type.slug} delayMs={i * 75}>
                <Link
                  href={`/waqf-types/${type.slug}`}
                  className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg hover:shadow-primary-950/5"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent-100 bg-accent-50 text-accent-700">
                    <type.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-[1.4rem] font-medium tracking-tight text-slate-900">{type.label} Waqf</h3>
                  <p className="mt-0.5 text-sm font-semibold italic text-accent-700">{WAQF_TYPE_EXTRA[type.slug].classical}</p>
                  <p className="mb-4 mt-3 text-[15px] leading-relaxed text-slate-600">{type.summary}</p>
                  <p className="mt-auto border-t border-slate-100 pt-4 text-sm leading-relaxed text-slate-500">
                    <span className="font-semibold text-primary-700">For example,</span> {WAQF_TYPE_EXTRA[type.slug].example}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-700 group-hover:text-primary-800">
                    Learn more <IconArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Governance ---------------- */}
      <section id="governance" className="bg-slate-50/80 px-6 py-16 sm:px-8 lg:py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal className="order-2 lg:order-1">
            <figure className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_30px_60px_-40px_rgba(8,39,32,0.35)] sm:p-7">
              <DualAuthorisationDiagram />
              <figcaption className="mt-4 text-sm italic text-slate-500">Enforced by the database itself — not left to policy or good intentions.</figcaption>
            </figure>
          </Reveal>
          <div className="order-1 lg:order-2">
            <SectionHead kicker="Governance" title="Built for a fiduciary, not a feature race." />
            <ul className="mt-6 space-y-4">
              {GOVERNANCE_POINTS.map((p) => (
                <li key={p.title} id={p.id} className="flex scroll-mt-28 gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary-100 bg-primary-50 text-primary-700">
                    <p.icon className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold text-slate-900">{p.title}</h3>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{p.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <ImpactSection impact={impact} photos={impactPhotos} />

      {/* ---------------- Open vaults ---------------- */}
      <section id="vaults" className="px-6 py-16 sm:px-8 lg:py-16">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="Support a cause"
            title="Open Vaults, right now."
            lead="Curated by Birr's own team, each tied to a named delivery partner. Give to the cause you choose."
            aside={
              openVaults !== null && openVaults.length > 0 ? (
                <Link href="/vaults" className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800">
                  Browse every open Vault <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : undefined
            }
          />

          {openVaults !== null && openVaults.length === 0 && (
            <p className="mt-9 rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
              No Vaults are open for giving right now — check back soon.
            </p>
          )}

          {/* A load failure shouldn't claim "nothing's open" — point to the
              full list, which has a real retry affordance. */}
          {vaultsLoadError && (
            <p className="mt-9 rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
              Couldn't load open Vaults right now.{" "}
              <Link href="/vaults" className="font-semibold text-primary-700 hover:text-primary-800">
                Try the full list
              </Link>
              .
            </p>
          )}

          {openVaults !== null && openVaults.length > 0 && (
            <div className="mt-9 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {openVaults.slice(0, VAULT_TEASER_LIMIT).map((vault, i) => (
                <Reveal key={vault.id} delayMs={i * 75}>
                  <VaultCard vault={vault} />
                </Reveal>
              ))}
            </div>
          )}

          <div className="mt-7 flex flex-col gap-4 rounded-2xl border border-accent-100 bg-accent-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-slate-700">
              <span className="font-semibold text-slate-900">A Vault gift is not a waqf — and that's the point.</span> It is spent on the need it
              was given for; a waqf is preserved and gives only what it produces.
            </p>
            <Link href="/#how-it-works" className="shrink-0 text-sm font-semibold text-primary-700 hover:text-primary-800">
              Compare the two →
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- Learn ---------------- */}
      {articles.length > 0 && (
        <section id="learn" className="bg-slate-50/80 px-6 py-16 sm:px-8 lg:py-16">
          <div className="mx-auto max-w-6xl">
            <SectionHead
              kicker="Learn"
              title="Plain-English guides."
              lead="Waqf, trusteeship and giving — written for people new to all three."
              aside={
                <Link href="/blog" className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800">
                  View all articles <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <div className="mt-9 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((a, i) => (
                <Reveal key={a.slug} delayMs={i * 75}>
                  <ArticleCard article={a} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- FAQ ---------------- */}
      <section id="faq" className="px-6 py-16 sm:px-8 lg:py-16">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
          <div>
            <SectionHead kicker="Questions" title="What founders ask first." />
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Can't find your answer? Write to{" "}
              <a href="mailto:info@birrwaqf.org" className="font-semibold text-primary-700 hover:text-primary-800">
                info@birrwaqf.org
              </a>
              .
            </p>
          </div>
          <div className="border-t border-slate-200">
            {FAQ_ITEMS.map((item, index) => (
              <details key={item.question} className="group border-b border-slate-200" open={index === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-left text-base font-semibold text-slate-900 marker:content-none sm:text-[17px]">
                  {item.question}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-primary-700 transition-transform group-open:rotate-45 motion-reduce:transition-none">
                    <span aria-hidden="true" className="text-lg leading-none">+</span>
                  </span>
                </summary>
                <p className="-mt-1 max-w-2xl pb-5 text-[15px] leading-relaxed text-slate-600">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Closing call to action ---------------- */}
      <section className="px-6 pb-16 sm:px-8">
        <Reveal className="mx-auto max-w-6xl">
          <div className="relative overflow-hidden rounded-3xl px-8 py-11 sm:px-12 sm:py-12" style={{ backgroundImage: GRADIENT }}>
            <GeometricPattern className="pointer-events-none absolute inset-0 h-full w-full text-accent-400/[0.1]" />
            <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <h2 className="font-display text-3xl font-medium tracking-tight text-white text-balance sm:text-4xl">Ready to establish your Waqf Fund?</h2>
                <p className="mt-3 max-w-xl text-base leading-relaxed text-primary-100/85">
                  No approval gate and no staff appointment to get started — just your Foundation, your first Waqf Fund, and a trustee
                  relationship that begins the moment you create it.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-xl bg-accent-500 px-6 py-3.5 text-base font-semibold text-primary-950 transition-colors hover:bg-accent-300"
                >
                  Establish your Waqf Fund
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-xl border border-white/25 px-6 py-3.5 text-base font-semibold text-white transition-colors hover:border-white/50 hover:bg-white/10"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}

// `split` puts the lead beside the title on wide screens rather than under
// it, so a section's heading takes one band and the content fits on screen.
function SectionHead({ kicker, title, lead, aside, split }: { kicker: string; title: string; lead?: string; aside?: ReactNode; split?: boolean }) {
  const heading = (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-700">{kicker}</p>
      <h2 className="mt-3 font-display text-3xl font-medium leading-[1.1] tracking-tight text-slate-900 text-balance sm:text-4xl">{title}</h2>
    </>
  );
  const leadText = lead && <p className="text-base leading-relaxed text-slate-600 text-pretty sm:text-[17px]">{lead}</p>;
  if (split) {
    return (
      <div className="grid gap-4 lg:grid-cols-2 lg:items-end lg:gap-12">
        <div>{heading}</div>
        {leadText}
      </div>
    );
  }
  return (
    <div className={aside ? "flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between" : undefined}>
      <div className="max-w-2xl">
        {heading}
        {leadText && <div className="mt-3.5">{leadText}</div>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

function CheckList({ items, tone }: { items: string[]; tone: "dark" | "light" }) {
  return (
    <ul className="mt-5 space-y-2.5">
      {items.map((item) => (
        <li key={item} className={`flex items-start gap-2.5 text-[15px] ${tone === "dark" ? "text-primary-50" : "text-slate-800"}`}>
          <IconCheckCircle className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${tone === "dark" ? "text-accent-300" : "text-primary-600"}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

// A card overlapping the monitor's edge — two of them narrate the two
// promises the product makes (dual authorisation; a preserved corpus).
// Wide screens only: on narrower ones they would cover the dashboard.
function FloatingNote({
  className,
  tone,
  title,
  line,
  note,
  icon,
}: {
  className: string;
  tone: "primary" | "accent";
  title: string;
  line: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <div
      className={`absolute z-10 hidden w-56 gap-2.5 rounded-xl bg-white p-3 shadow-[0_26px_50px_-20px_rgba(8,39,32,0.5)] ring-1 ring-slate-900/5 xl:flex ${className}`}
      aria-hidden="true"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          tone === "primary" ? "bg-primary-50 text-primary-700" : "bg-accent-50 text-accent-700"
        }`}
      >
        {icon}
      </span>
      <div>
        <p className="text-[12.5px] font-bold leading-tight text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs text-slate-600">{line}</p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">{note}</p>
      </div>
    </div>
  );
}

// Founder → corpus → beneficiaries, with the trustee administering all
// three — the same figure as page 3 of the Waqf Founder's Handbook.
function WaqfDiagram() {
  const b = { fontSize: 9.5, fontWeight: 600, fill: "#113f33" };
  const s = { fontSize: 8, fill: "#475569" };
  const ar = { fontSize: 8, fontStyle: "italic" as const, fontWeight: 600, fill: "#7c5514" };
  return (
    <svg
      viewBox="0 0 360 150"
      className="block h-auto w-full"
      role="img"
      aria-label="How a waqf works: the founder endows a corpus that is never spent; what it produces reaches the beneficiaries; Birr administers it all as trustee."
    >
      <defs>
        <marker id="home-waqf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#17755d" />
        </marker>
      </defs>
      <rect x="1" y="22" width="84" height="50" rx="7" fill="#eff9f6" stroke="#aee1d1" />
      <text x="43" y="44" textAnchor="middle" style={b}>Founder</text>
      <text x="43" y="59" textAnchor="middle" style={ar}>waqif</text>
      <path d="M88 47H129" fill="none" stroke="#17755d" strokeWidth="1.4" markerEnd="url(#home-waqf-arrow)" />
      <text x="108.5" y="39" textAnchor="middle" style={s}>endows</text>
      <rect x="133" y="14" width="94" height="66" rx="8" fill="#113f33" />
      <text x="180" y="40" textAnchor="middle" style={{ ...b, fill: "#fff" }}>Corpus</text>
      <text x="180" y="54" textAnchor="middle" style={{ ...ar, fill: "#f3d888" }}>mawquf</text>
      <text x="180" y="68" textAnchor="middle" style={{ ...s, fill: "#d7f0e8" }}>never spent</text>
      <path d="M230 47H271" fill="none" stroke="#17755d" strokeWidth="1.4" markerEnd="url(#home-waqf-arrow)" />
      <text x="250.5" y="39" textAnchor="middle" style={s}>produces</text>
      <rect x="275" y="22" width="84" height="50" rx="7" fill="#eff9f6" stroke="#aee1d1" />
      <text x="317" y="44" textAnchor="middle" style={b}>Beneficiaries</text>
      <text x="317" y="59" textAnchor="middle" style={ar}>mawquf alayh</text>
      <path d="M43 74V100M180 82V100M317 74V100" fill="none" stroke="#e6c46f" strokeWidth="1.2" strokeDasharray="2 2.5" />
      <rect x="1" y="100" width="358" height="46" rx="7" fill="#fdf8ec" stroke="#f3d888" />
      <text x="180" y="119" textAnchor="middle" style={{ ...b, fill: "#7c5514" }}>
        Trustee · <tspan style={{ fontStyle: "italic" }}>mutawalli</tspan>
      </text>
      <text x="180" y="134" textAnchor="middle" style={s}>
        Birr administers and preserves the waqf — after its founder, too
      </text>
    </svg>
  );
}

// Dual authorisation: proposer, a different approver, then the action —
// and the refused path when the proposer tries to approve their own.
function DualAuthorisationDiagram() {
  const b = { fontSize: 9.5, fontWeight: 600, fill: "#113f33" };
  const s = { fontSize: 8, fill: "#475569" };
  return (
    <svg
      viewBox="0 0 360 134"
      className="block h-auto w-full"
      role="img"
      aria-label="Officer A proposes, a different Officer B approves, and only then is the action carried out and recorded. If Officer A tries to approve their own proposal, the system refuses to record it."
    >
      <defs>
        <marker id="home-auth-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#17755d" />
        </marker>
        <marker id="home-auth-refused" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#a23b2a" />
        </marker>
      </defs>
      <rect x="1" y="10" width="92" height="50" rx="7" fill="#eff9f6" stroke="#aee1d1" />
      <text x="47" y="31" textAnchor="middle" style={b}>Officer A</text>
      <text x="47" y="46" textAnchor="middle" style={s}>proposes</text>
      <path d="M96 35H130" fill="none" stroke="#17755d" strokeWidth="1.4" markerEnd="url(#home-auth-arrow)" />
      <rect x="134" y="10" width="92" height="50" rx="7" fill="#eff9f6" stroke="#aee1d1" />
      <text x="180" y="31" textAnchor="middle" style={b}>Officer B</text>
      <text x="180" y="46" textAnchor="middle" style={s}>reviews &amp; approves</text>
      <path d="M229 35H263" fill="none" stroke="#17755d" strokeWidth="1.4" markerEnd="url(#home-auth-arrow)" />
      <rect x="267" y="10" width="92" height="50" rx="7" fill="#113f33" />
      <text x="313" y="31" textAnchor="middle" style={{ ...b, fill: "#fff" }}>Carried out</text>
      <text x="313" y="46" textAnchor="middle" style={{ ...s, fill: "#d7f0e8" }}>and recorded</text>
      <path d="M47 62V107H130" fill="none" stroke="#a23b2a" strokeWidth="1.3" strokeDasharray="3 2.6" markerEnd="url(#home-auth-refused)" />
      <rect x="134" y="84" width="225" height="46" rx="7" fill="#fbeeeb" stroke="#e7b4aa" />
      <text x="246.5" y="103" textAnchor="middle" style={s}>Officer A tries to approve their own proposal</text>
      <text x="246.5" y="119" textAnchor="middle" style={{ ...b, fill: "#a23b2a" }}>The system refuses to record it</text>
    </svg>
  );
}
