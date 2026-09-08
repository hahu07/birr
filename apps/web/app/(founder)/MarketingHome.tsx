"use client";

// Public landing page — the signed-out counterpart rendered at "/" by
// page.tsx (see app-shell.tsx's HOME_ROUTE handling: this is the one
// route that's public-or-private depending on session, not purely one
// or the other). No Founder Portal chrome — a first-time visitor hasn't
// signed up yet, so every fact on this page has to stand on its own,
// not lean on nav/context that only exists once signed in.
import Link from "next/link";
import {
  Button,
  Card,
  IconLandmark,
  IconClipboardCheck,
  IconUsers,
  IconFileText,
  IconGlobe,
  IconSparkle,
} from "@birr/ui";
import { GRADIENT, Reveal, SiteFooter, SiteHeader } from "./SiteChrome";
import { WAQF_TYPE_CONTENT, WAQF_TYPE_SLUGS } from "./waqf-types/content";

// The three Waqf Fund types a Founder can establish — WAQF_TYPE_CONTENT
// (waqf-types/content.ts) is the single source for this, shared with
// the /waqf-types/[slug] detail pages each card below links to, so the
// summary here and the fuller page can never drift apart.
const WAQF_TYPES = WAQF_TYPE_SLUGS.map((slug) => WAQF_TYPE_CONTENT[slug]);

const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Establish",
    body: "Sign up and create your Foundation and Waqf Fund yourself, self-service. Birr becomes Mutawalli the moment you establish it — no approval gate.",
  },
  {
    n: "02",
    title: "Govern",
    body: "From here, Birr's own staff carry ongoing governance — every asset, distribution, and investment change runs through maker-checker approval.",
  },
  {
    n: "03",
    title: "Distribute",
    body: "Approved distributions reach the causes you've selected, capped at exactly the amount you've allocated to each — never a cent more.",
  },
  {
    n: "04",
    title: "Audit",
    body: "Every governed action is written to an immutable, append-only trail from establishment onward — there for your own reporting, always.",
  },
];

const TRUST_STRIP = [
  "Mutawalli from establishment, no approval gate",
  "Maker ≠ checker, enforced by the database",
  "Immutable, append-only audit trail",
  "AI can propose — only a human approves",
];

// A primary/accent/violet trio, not a rainbow: violet is reserved for
// the AI Agents surface (see styles.css's documented hue rationale), so
// it appears exactly once below, on the one pillar that's actually
// about AI. Every other pillar alternates the two chrome-carrying hues
// (primary, accent) so the grid reads as one considered palette, not
// six unrelated tiles.
const GOVERNANCE_PILLARS = [
  {
    title: "Self-service establishment",
    body: "Create your Foundation and Waqf Fund directly. Establishing a fund is itself how you agree Birr becomes Mutawalli over it.",
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
    body: "Governance aligns with AAOIFI and IFSB principles and the regulatory requirements of each waqf's own jurisdiction, not one policy applied everywhere.",
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
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <section className="relative overflow-hidden px-6 pb-24 pt-20 sm:px-8 sm:pt-28" style={{ backgroundImage: GRADIENT }}>
        <div
          className="pointer-events-none absolute -right-32 -top-32 h-[36rem] w-[36rem] rounded-full bg-white/10 blur-3xl motion-safe:animate-[float-slow_16s_ease-in-out_infinite]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-accent-400/10 blur-3xl motion-safe:animate-[float-slow_20s_ease-in-out_infinite_reverse]"
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
          <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/70">Waqf Trustee Platform</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            A digital trustee for Islamic waqf.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/80">
            Establish your own Foundation and Waqf Fund, self-service — Birr becomes Mutawalli (trustee) over what
            you establish, as you agree, no approval gate. Every decision from there runs through the same
            maker-checker governance a fiduciary system demands.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
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
      </section>

      {/* Elevated trust strip, overlapping the hero's bottom edge — the
          four structural guarantees a fiduciary system has to earn, not
          fabricated usage numbers a pre-launch platform doesn't have. */}
      <div className="relative z-20 mx-auto -mt-10 max-w-5xl px-6 sm:px-8">
        <Reveal>
          <div className="grid grid-cols-1 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-xl sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            {TRUST_STRIP.map((item) => (
              <p key={item} className="px-5 py-5 text-center text-sm font-medium leading-snug text-slate-700">
                {item}
              </p>
            ))}
          </div>
        </Reveal>
      </div>

      <section id="waqf-types" className="px-6 pb-20 pt-24 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">What Birr manages</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Three kinds of Waqf Fund, one trustee.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Every Waqf Fund you establish under a Foundation is its own distinct endowment — its own assets, purpose,
            and jurisdiction — even when several share the same Founder.
          </p>
        </Reveal>
        <div className="mx-auto mt-10 grid max-w-4xl gap-5 sm:grid-cols-3">
          {WAQF_TYPES.map((type, i) => (
            <Reveal key={type.slug} delayMs={i * 75}>
              <Link href={`/waqf-types/${type.slug}`} className="group block h-full">
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
            </Reveal>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="bg-gradient-to-b from-primary-50/60 to-white px-6 py-20 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">How it works</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Establishment is yours. Governance is ours.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Two deliberately different postures, not the same rule applied twice — self-service to start, then
            Birr-staff-mediated for everything that moves money afterward.
          </p>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-5xl gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((step, i) => (
            <Reveal key={step.n} delayMs={i * 90} className="relative">
              <span className="text-4xl font-semibold tracking-tight text-primary-100" aria-hidden="true">
                {step.n}
              </span>
              <h3 className="-mt-2 text-sm font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
            </Reveal>
          ))}
        </div>
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
