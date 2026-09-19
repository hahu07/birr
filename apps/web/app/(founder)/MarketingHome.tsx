"use client";

// Public landing page — the signed-out counterpart rendered at "/" by
// page.tsx (see app-shell.tsx's HOME_ROUTE handling: this is the one
// route that's public-or-private depending on session, not purely one
// or the other). No Founder Portal chrome — a first-time visitor hasn't
// signed up yet, so every fact on this page has to stand on its own,
// not lean on nav/context that only exists once signed in.
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  IconArchive,
  IconCheckCircle,
  IconLandmark,
  IconClipboardCheck,
  IconRepeat,
  IconUsers,
  IconFileText,
  IconGlobe,
  IconSparkle,
} from "@birr/ui";
import { apiFetchJson } from "../../lib/api";
import type { Vault } from "../../lib/types";
import { GRADIENT, Reveal, SiteFooter, SiteHeader, VaultCard } from "./SiteChrome";
import { WAQF_TYPE_CONTENT, WAQF_TYPE_SLUGS } from "./waqf-types/content";

// The three Waqf Fund types a Founder can establish — WAQF_TYPE_CONTENT
// (waqf-types/content.ts) is the single source for this, shared with
// the /waqf-types/[slug] detail pages each card below links to, so the
// summary here and the fuller page can never drift apart.
const WAQF_TYPES = WAQF_TYPE_SLUGS.map((slug) => WAQF_TYPE_CONTENT[slug]);

// Hero subheadline's rotating close — four real, distinct facts about
// governed_actions (never a claim this codebase doesn't actually back:
// see CLAUDE.md's own non-negotiables), cycled so the sentence keeps
// making its case rather than saying the same four words forever.
const GOVERNANCE_PROOF_PHRASES = [
  "checked twice, logged forever.",
  "reviewed by someone else.",
  "recorded, never erased.",
  "provable, not promised.",
];

// Two parallel four-step paths through the same platform — a Founder
// establishes and governs their own fund; anyone else can support one of
// Birr's own Vaults without ever establishing anything. Deliberately the
// same four-beat rhythm (self-service action -> Birr-mediated middle ->
// money reaches a cause -> audited) so the two paths read as siblings,
// not a primary flow with an afterthought bolted on — see the "one
// platform, many possibilities" framing this was built around.
const HOW_IT_WORKS_FOUNDER = [
  {
    n: "01",
    title: "Establish",
    body: "Sign up and create your Foundation and Waqf Fund yourself, self-service. Birr becomes Mutawalli the moment you establish it — no approval gate.",
    icon: IconLandmark,
  },
  {
    n: "02",
    title: "Govern",
    body: "From here, Birr's own staff carry ongoing governance — every asset, distribution, and investment change runs through maker-checker approval.",
    icon: IconClipboardCheck,
  },
  {
    n: "03",
    title: "Distribute",
    // 2026-09-19 founder-facing copy pass (CLAUDE.md's 2026-09-04
    // decision): the old wording ("capped at exactly the amount you've
    // allocated... never a cent more") is only true for Asset/Project
    // funds. For an Investment fund, corpus allocation is a
    // preservation target, not a spending ceiling — investment
    // proceeds are what's actually distributable there (see
    // CausesSection.tsx/ProceedsSection.tsx's own type-aware copy).
    // Kept type-neutral here rather than caveated, since this is a
    // 4-step marketing summary, not the place for that distinction —
    // the dedicated pages above carry the full explanation.
    body: "Approved distributions reach the causes you've selected, never past the ceiling you've set for each.",
    icon: IconCheckCircle,
  },
  {
    n: "04",
    title: "Audit",
    body: "Every governed action is written to an immutable, append-only trail from establishment onward — there for your own reporting, always.",
    icon: IconFileText,
  },
];

// Reuses IconClipboardCheck for "Reach" and IconFileText for "Audit" —
// the exact same icons as the Founder path's "Govern"/"Audit" steps,
// deliberately, not an oversight — both pairs literally route through
// the identical maker-checker engine and the identical audit trail (see
// each step's own body copy), so the shared icon reinforces "same
// governance, either door" instead of implying two different systems.
const HOW_IT_WORKS_GIVER = [
  {
    n: "01",
    title: "Discover",
    body: "Browse Birr-curated vaults and the causes each one supports — no account needed to look.",
    icon: IconGlobe,
  },
  {
    n: "02",
    title: "Give",
    body: "Contribute any amount by card, bank transfer, or stablecoin. One email is all that's required for a receipt.",
    icon: IconRepeat,
  },
  {
    n: "03",
    title: "Reach",
    body: "Birr allocates and disburses to the vault's causes through the exact same maker-checker approval as every Waqf Fund.",
    icon: IconClipboardCheck,
  },
  {
    n: "04",
    title: "Audit",
    body: "Every contribution and disbursement is written to the same immutable, append-only trail — nothing lighter for a smaller gift.",
    icon: IconFileText,
  },
];

// Vault has only two types (see VaultType's own schema comment — no
// "asset" value, a vault is always pooled cash, never a registered
// individual asset), described statically here rather than from a
// per-type content module like WAQF_TYPE_CONTENT — there's no dedicated
// public page per vault type yet, so each links to the /vaults index
// instead.
const VAULT_TYPES = [
  {
    icon: IconLandmark,
    label: "Investment-style vault",
    summary: "Pooled gifts are placed with a counterparty; the return funds the vault's causes, corpus stays intact.",
  },
  {
    icon: IconArchive,
    label: "Project-style vault",
    summary: "Pooled gifts go directly to the vault's causes — relief, education, whatever it was created for.",
  },
];

// The homepage stays a teaser, not a duplicate of the dedicated /vaults
// index — cap it here and point to that page for the rest, same
// "preview here, full list there" relationship the /waqf-types/[slug]
// pages already have with this page's own summary cards above.
const VAULT_TEASER_LIMIT = 6;

// A primary/accent/violet trio, not a rainbow: violet is reserved for
// the AI Agents surface (see styles.css's documented hue rationale), so
// it appears exactly once below, on the one pillar that's actually
// about AI. Every other pillar alternates the two chrome-carrying hues
// (primary, accent) so the grid reads as one considered palette, not
// six unrelated tiles.
const GOVERNANCE_PILLARS = [
  {
    title: "Self-service establishment",
    body: "Create your Foundation and Waqf Fund directly — establishing a fund is itself how you agree Birr becomes Mutawalli over it. The Founder path in; a Vault needs no establishment at all.",
    icon: IconLandmark,
    tone: "primary" as const,
  },
  {
    title: "Maker-checker, enforced by the database",
    body: "Every asset disposal, distribution, and investment change is proposed by one person and approved by another — never the same person, a rule the database itself rejects otherwise.",
    icon: IconClipboardCheck,
    tone: "accent" as const,
  },
  {
    title: "Segregation of duties",
    body: "Mutawalli Officer, Board of Trustees, Shariah Supervisory Board, Investment Committee, Audit Committee, Risk & Compliance, and Legal Adviser — distinct roles, distinct permissions.",
    icon: IconUsers,
    tone: "primary" as const,
  },
  {
    title: "Immutable audit trail",
    body: "Every write to a governed record is logged — actor, timestamp, before and after. Append-only: nothing in the trail can be edited or deleted, by design, not just by policy.",
    icon: IconFileText,
    tone: "accent" as const,
  },
  {
    title: "Jurisdiction-aware compliance",
    body: "Governance aligns with AAOIFI and IFSB principles and the regulatory requirements of each waqf's or vault's own jurisdiction, not one policy applied everywhere.",
    icon: IconGlobe,
    tone: "primary" as const,
  },
  {
    title: "AI proposes, humans decide",
    body: "AI agents may draft, flag, and monitor — never approve. There's no field in our system for an AI checker; every fiduciary decision stays with a person.",
    icon: IconSparkle,
    tone: "violet" as const,
  },
];

const PILLAR_ICON_CLASSES: Record<(typeof GOVERNANCE_PILLARS)[number]["tone"], string> = {
  primary: "bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-primary-900/25",
  // Deep-on-gold, not white-on-gold: a lighter gold field with a
  // near-black glyph clears AA with margin and reads as more premium
  // than white text over the same stops.
  accent: "bg-gradient-to-br from-accent-300 to-accent-500 text-accent-950 shadow-accent-900/20",
  violet: "bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-violet-900/25",
};

export default function MarketingHome() {
  const [howItWorksPath, setHowItWorksPath] = useState<"founder" | "giver">("founder");
  const [managesProduct, setManagesProduct] = useState<"waqf" | "vault">("waqf");

  // Real data, not a placeholder — GET /vaults/open is @Public(), no
  // session needed. Each vault's own causes come embedded in the
  // listOpen() response itself (see VaultsService.listOpen's own
  // comment) — GET /vaults/:id/causes is staff-only, not something this
  // unauthenticated page could call per vault to fill them in afterward.
  const [openVaults, setOpenVaults] = useState<Vault[] | null>(null);

  useEffect(() => {
    apiFetchJson<Vault[]>("/vaults/open")
      .then(setOpenVaults)
      .catch(() => setOpenVaults([]));
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <section className="relative overflow-hidden px-6 pb-28 pt-24 sm:px-8 sm:pt-32" style={{ backgroundImage: GRADIENT }}>
        <div
          className="pointer-events-none absolute -right-32 -top-32 h-[36rem] w-[36rem] rounded-full bg-white/10 blur-3xl motion-safe:animate-[float-slow_16s_ease-in-out_infinite]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-accent-400/10 blur-3xl motion-safe:animate-[float-slow_20s_ease-in-out_infinite_reverse]"
          aria-hidden="true"
        />
        {/* A third, smaller orb behind the headline itself — the two
            above sit at the corners; this gives the type block its own
            faint halo instead of floating on flat gradient. */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/3 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-white/[0.06] blur-3xl motion-safe:animate-[float-slow_24s_ease-in-out_infinite]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(115deg, transparent 0px, transparent 58px, rgba(255,255,255,0.6) 58px, rgba(255,255,255,0.6) 59px)",
          }}
          aria-hidden="true"
        />
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <Reveal>
            {/* A live figure, not a decorative label — falls back to a
                plain category pill until openVaults has actually loaded
                or if nothing's open right now, so this never flashes a
                wrong or deflating "0" on first paint. */}
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-white/80 backdrop-blur-sm">
              {openVaults && openVaults.length > 0 ? (
                <>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400 motion-safe:animate-pulse" aria-hidden="true" />
                  {openVaults.length} {openVaults.length === 1 ? "vault" : "vaults"} open for giving right now
                </>
              ) : (
                "Waqf & Vault Trustee Platform"
              )}
            </p>
          </Reveal>
          <Reveal delayMs={90}>
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              A gift that outlives you.
              <br className="hidden sm:block" />
              {/* Explicit space — without it, JSX collapses the
                  whitespace between the (mobile-hidden) <br> and this
                  span to nothing, running "you.Sadaqah" together once
                  the <br> disappears below the sm breakpoint. */}
              <span> </span>
              <span className="bg-gradient-to-r from-accent-300 to-accent-500 bg-clip-text text-transparent">
                Sadaqah Jariyah, engineered to prove it.
              </span>
            </h1>
          </Reveal>
          <Reveal delayMs={180}>
            {/* A div, not a <p> — Reveal renders a <div>, and the nested
                Reveal below (the punchline) would be invalid HTML nested
                inside a real <p> (browsers silently close the paragraph
                early on a block child, splitting the sentence). */}
            <div className="mx-auto mt-6 max-w-xl text-balance text-lg text-white/80">
              One governance engine. Every decision — <RotatingPhrase phrases={GOVERNANCE_PROOF_PHRASES} />
            </div>
          </Reveal>
          <Reveal delayMs={270}>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/sign-up" className="w-full sm:w-auto">
                <Button
                  variant="secondary"
                  className="w-full px-6 py-3 text-base shadow-lg shadow-black/20 transition-transform motion-safe:hover:-translate-y-0.5"
                >
                  Establish your Waqf Fund
                </Button>
              </Link>
              <Link
                href="/vaults"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-white/30 px-6 py-3 text-base font-medium text-white transition-colors hover:border-white/60 hover:bg-white/10 sm:w-auto"
              >
                Support a cause <span aria-hidden="true">→</span>
              </Link>
            </div>
            <Link href="/sign-in" className="mt-5 inline-block text-sm font-medium text-white/70 hover:text-white">
              Already have an account? Sign in →
            </Link>
          </Reveal>
        </div>
      </section>

      <section id="waqf-types" className="px-6 pb-20 pt-24 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">What Birr manages</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Two products, one trustee.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Waqf Funds you establish yourself, and Vaults Birr curates for anyone to support — different products,
            the same maker-checker governance and audit trail underneath.
          </p>
        </Reveal>

        <div className="mx-auto mt-8 flex max-w-2xl justify-center gap-2">
          <button
            type="button"
            onClick={() => setManagesProduct("waqf")}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              managesProduct === "waqf" ? "bg-primary-700 text-white" : "border border-slate-200 text-slate-500 hover:border-primary-300"
            }`}
          >
            Waqf Funds
          </button>
          <button
            type="button"
            onClick={() => setManagesProduct("vault")}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              managesProduct === "vault" ? "bg-accent-500 text-accent-950" : "border border-slate-200 text-slate-500 hover:border-accent-300"
            }`}
          >
            Vaults
          </button>
        </div>

        <SlideTrack
          className="mx-auto mt-10 max-w-4xl"
          active={managesProduct === "waqf" ? "left" : "right"}
          left={
            <>
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-primary-700">
                Waqf Funds <span className="font-medium normal-case text-slate-500">— you establish, self-service</span>
              </p>
              <div className="grid gap-5 sm:grid-cols-3">
                {WAQF_TYPES.map((type) => (
                  <Link key={type.slug} href={`/waqf-types/${type.slug}`} className="group block h-full">
                    <Card tone="neutral" className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
                      <span
                        className="mb-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-100"
                        aria-hidden="true"
                      >
                        <type.icon className="h-5 w-5" />
                      </span>
                      <h3 className="text-sm font-semibold text-slate-900">{type.label}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{type.summary}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary-700 group-hover:text-primary-800">
                        Learn more <span aria-hidden="true">→</span>
                      </span>
                    </Card>
                  </Link>
                ))}
              </div>
            </>
          }
          right={
            <>
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-accent-700">
                Vaults <span className="font-medium normal-case text-slate-500">— Birr curates, anyone can support</span>
              </p>
              <div className="mx-auto grid gap-5 sm:grid-cols-2 sm:max-w-xl">
                {VAULT_TYPES.map((type) => (
                  <Link key={type.label} href="/vaults" className="group block h-full">
                    <Card tone="accent" className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
                      <span
                        className="mb-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-100 text-accent-700 ring-1 ring-inset ring-accent-200"
                        aria-hidden="true"
                      >
                        <type.icon className="h-5 w-5" />
                      </span>
                      <h3 className="text-sm font-semibold text-slate-900">{type.label}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{type.summary}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-700 group-hover:text-accent-800">
                        See open vaults <span aria-hidden="true">→</span>
                      </span>
                    </Card>
                  </Link>
                ))}
              </div>
            </>
          }
        />
      </section>

      <section id="how-it-works" className="bg-gradient-to-b from-primary-50/60 to-white px-6 py-20 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">How it works</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Two paths, one trustee.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Whichever door you came through, the same governance runs underneath. Click a path to switch.
          </p>
        </Reveal>

        <div className="mx-auto mt-6 flex max-w-2xl justify-center gap-2">
          <button
            type="button"
            onClick={() => setHowItWorksPath("founder")}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              howItWorksPath === "founder" ? "bg-primary-700 text-white" : "border border-slate-200 text-slate-500 hover:border-primary-300"
            }`}
          >
            For Founders
          </button>
          <button
            type="button"
            onClick={() => setHowItWorksPath("giver")}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              howItWorksPath === "giver" ? "bg-accent-500 text-accent-950" : "border border-slate-200 text-slate-500 hover:border-accent-300"
            }`}
          >
            For Everyone
          </button>
        </div>

        <SlideTrack
          className="mx-auto mt-10 max-w-lg"
          active={howItWorksPath === "founder" ? "left" : "right"}
          left={
            <>
              <p className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span className="h-2 w-2 rounded-full bg-primary-600" aria-hidden="true" /> Founder path
              </p>
              <div className="space-y-6">
                {HOW_IT_WORKS_FOUNDER.map((step) => (
                  <div key={step.n} className="flex gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
                      <step.icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/waqf-types" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800">
                See how establishing works <span aria-hidden="true">→</span>
              </Link>
            </>
          }
          right={
            <>
              <p className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span className="h-2 w-2 rounded-full bg-accent-500" aria-hidden="true" /> Giver path
              </p>
              <div className="space-y-6">
                {HOW_IT_WORKS_GIVER.map((step) => (
                  <div key={step.n} className="flex gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-800">
                      <step.icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/vaults" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent-700 hover:text-accent-800">
                Browse open vaults <span aria-hidden="true">→</span>
              </Link>
            </>
          }
        />
      </section>

      <section id="vaults" className="px-6 py-20 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">Support a cause</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Open vaults, right now.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Every vault is curated by Birr's own team and tied to one or more causes from our standard catalog —
            the same catalog every Waqf Fund draws from.
          </p>
        </Reveal>

        {openVaults !== null && openVaults.length === 0 && (
          <p className="mx-auto mt-10 max-w-md text-center text-sm text-slate-500">
            No vaults are open for giving right now — check back soon.
          </p>
        )}

        {openVaults !== null && openVaults.length > 0 && (
          <div className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {openVaults.slice(0, VAULT_TEASER_LIMIT).map((vault, i) => (
              <Reveal key={vault.id} delayMs={i * 75}>
                <VaultCard vault={vault} />
              </Reveal>
            ))}
          </div>
        )}

        {openVaults !== null && openVaults.length > 0 && (
          <Link
            href="/vaults"
            className="mt-8 block text-center text-sm font-semibold text-primary-700 hover:text-primary-800"
          >
            Browse every open vault <span aria-hidden="true">→</span>
          </Link>
        )}

      </section>

      <section id="governance" className="px-6 py-20 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">Governance</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Built for a fiduciary, not a feature race.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Correctness, auditability, and access control — enforced structurally, not left to policy alone.
          </p>
        </Reveal>
        <div className="mx-auto mt-10 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {GOVERNANCE_PILLARS.map((pillar, i) => (
            <Reveal key={pillar.title} delayMs={(i % 3) * 75}>
              <Card tone={pillar.tone} className="h-full">
                <span
                  className={`mb-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${PILLAR_ICON_CLASSES[pillar.tone]}`}
                  aria-hidden="true"
                >
                  <pillar.icon className="h-5 w-5" />
                </span>
                <h3 className="text-sm font-semibold text-slate-900">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{pillar.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="ai" className="bg-violet-50/60 px-6 py-20 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <Reveal>
            <Card tone="violet" className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-sm shadow-violet-900/25"
                aria-hidden="true"
              >
                <IconSparkle className="h-7 w-7" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-violet-700">Artificial intelligence</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Advisory only — enforced structurally.</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-700">
                  AI agents assist Birr's officers behind the scenes — watching regulatory change, triaging caseloads,
                  spotting anomalies, drafting distribution recommendations — every one of them scoped to its own
                  registry entry, never an undifferentiated "the AI." Any agent may propose a governed action; none
                  can ever approve one. That's not a policy an officer could override — there's no{" "}
                  <code className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-xs text-violet-900">checker_agent_id</code>{" "}
                  field in our schema for a human to fill in, by design.
                </p>
              </div>
            </Card>
          </Reveal>
        </div>
      </section>

      <section className="px-6 pb-24 pt-4 sm:px-8">
        <Reveal className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden rounded-2xl px-8 py-14 text-center sm:px-16" style={{ backgroundImage: GRADIENT }}>
            <div
              className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl"
              aria-hidden="true"
            />
            <h2 className="relative text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Ready to establish your Waqf Fund?
            </h2>
            <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/80">
              No approval gate, no Birr staff involvement to get started — just your Foundation, your first Waqf
              Fund, and a trustee relationship that begins the moment you create it.
            </p>
            <div className="relative mt-7 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/sign-up" className="w-full sm:w-auto">
                <Button variant="secondary" className="w-full">
                  Sign up
                </Button>
              </Link>
              <Link href="/sign-in" className="text-sm font-medium text-white/80 hover:text-white">
                Already have an account? Sign in →
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}

// Cycles through a short list of phrases in place — each one fades/
// slides in via a CSS keyframe (globals.css's own rotate-word-in) that
// re-plays because `key={index}` forces React to re-mount the <span>
// on every change, not because any class gets toggled by hand. The
// interval itself is skipped under prefers-reduced-motion (same check
// SiteChrome's own useInView makes for Reveal) — auto-changing text is
// exactly the kind of motion that preference exists to turn off, not
// just the transition between changes.
function RotatingPhrase({ phrases, intervalMs = 2600 }: { phrases: string[]; intervalMs?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % phrases.length), intervalMs);
    return () => window.clearInterval(id);
  }, [phrases, intervalMs]);

  return (
    <span
      key={index}
      className="inline-block motion-safe:animate-[rotate-word-in_500ms_ease-out] font-semibold bg-gradient-to-r from-accent-300 to-accent-500 bg-clip-text text-transparent"
    >
      {phrases[index]}
    </span>
  );
}

// Real slide, not a visibility toggle — both panels sit side by side in
// one 200%-wide flex row, translated by exactly one panel-width per
// click (overflow-hidden on the outer div crops whichever isn't active).
// Plain flexbox alone leaves the wrapper as tall as the TALLER of the
// two panels even while showing the shorter one — a flex row's own
// height always follows its tallest child regardless of which is
// visible — so the outer div's own height is measured from the active
// panel and animated to match, closing that gap instead of leaving dead
// space below the shorter panel. Re-measures on every resize too, since
// text reflow at a different width changes each panel's own height.
function SlideTrack({ active, left, right, className = "" }: { active: "left" | "right"; left: ReactNode; right: ReactNode; className?: string }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const measure = () => {
      const el = active === "left" ? leftRef.current : rightRef.current;
      if (el) setHeight(el.offsetHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, left, right]);

  return (
    // motion-reduce:transition-none on both layers — same convention
    // Reveal (SiteChrome.tsx) already uses, applied here too (found in a
    // codebase audit: this component had no reduced-motion handling at
    // all, so switching tabs always animated regardless of OS setting).
    // The height/position still update instantly; only the animation
    // between them is skipped.
    <div className={`overflow-hidden transition-[height] duration-500 ease-in-out motion-reduce:transition-none ${className}`} style={{ height }}>
      <div
        className="flex transition-transform duration-500 ease-in-out motion-reduce:transition-none"
        style={{ width: "200%", transform: active === "left" ? "translateX(0%)" : "translateX(-50%)" }}
      >
        <div ref={leftRef} className="w-1/2 shrink-0 px-1 self-start">
          {left}
        </div>
        <div ref={rightRef} className="w-1/2 shrink-0 px-1 self-start">
          {right}
        </div>
      </div>
    </div>
  );
}
