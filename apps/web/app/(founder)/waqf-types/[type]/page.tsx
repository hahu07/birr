"use client";

// Detail page for one Waqf Fund type — reached from the marketing
// home's summary cards ("Learn more →"). Public, reachable whether or
// not a founder session exists (see app-shell.tsx's PUBLIC_ROUTE_PREFIXES),
// same posture as the home page itself. Client component + useParams,
// matching this app's existing dynamic-route convention (see
// portfolio/[id]/page.tsx) rather than the Server Component async-params
// pattern.
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Card, IconCheckCircle } from "@birr/ui";
import { GRADIENT, Reveal, SiteFooter, SiteHeader } from "../../SiteChrome";
import { WAQF_TYPE_CONTENT, WAQF_TYPE_SLUGS, WaqfTypeSlug } from "../content";

function isWaqfTypeSlug(value: string): value is WaqfTypeSlug {
  return (WAQF_TYPE_SLUGS as readonly string[]).includes(value);
}

export default function WaqfTypeDetailPage() {
  const params = useParams<{ type: string }>();
  const slug = params.type;

  if (!isWaqfTypeSlug(slug)) {
    return (
      <div className="min-h-screen bg-white">
        <SiteHeader />
        <div className="mx-auto max-w-2xl px-6 py-24 text-center sm:px-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">No such Waqf Fund type.</h1>
          <p className="mt-3 text-sm text-slate-600">
            There's no "{slug}" type — Birr supports Investment, Asset, and Project Waqf Funds.
          </p>
          <Link href="/" className="mt-6 inline-flex text-sm font-medium text-primary-700 hover:text-primary-800">
            ← Back to Birr
          </Link>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const content = WAQF_TYPE_CONTENT[slug];
  const otherTypes = WAQF_TYPE_SLUGS.filter((s) => s !== slug).map((s) => WAQF_TYPE_CONTENT[s]);
  const Illustration = content.illustration;

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <section className="bg-gradient-to-br from-primary-50 to-accent-50 px-6 pb-16 pt-14 sm:px-8 sm:pt-20">
        <div className="mx-auto max-w-6xl">
          <Link href="/#waqf-types" className="text-sm font-medium text-primary-700 hover:text-primary-800">
            ← All Waqf Fund types
          </Link>
          <div className="mt-6 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <span
                className="mb-5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-sm shadow-primary-900/25"
                aria-hidden="true"
              >
                <content.icon className="h-6 w-6" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">Waqf Fund type</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{content.label}</h1>
              <p className="mt-3 text-lg leading-relaxed text-slate-700">{content.tagline}</p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <Link href="/sign-up" className="w-full sm:w-auto">
                  <Button variant="primary" className="w-full">
                    Establish {content.article} {content.label} Fund
                  </Button>
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Already have an account? Sign in →
                </Link>
              </div>
            </Reveal>
            <Reveal delayMs={100} className="mx-auto w-full max-w-md">
              <Illustration className="h-auto w-full" />
            </Reveal>
          </div>
        </div>
      </section>

      <section className="px-6 py-16 sm:px-8">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-3">
          <Reveal className="lg:col-span-2">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">What it means</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">{content.description}</p>

            <div className="mt-6 rounded-xl border border-accent-200 bg-accent-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">A real example</p>
              <p className="mt-2 text-sm italic leading-relaxed text-accent-950">{content.example}</p>
            </div>

            <h2 className="mt-10 text-xl font-semibold tracking-tight text-slate-900">How governance works</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">{content.governance}</p>
          </Reveal>

          <Reveal delayMs={75}>
            <Card tone="primary" className="sticky top-24">
              <h3 className="text-sm font-semibold text-primary-950">Is this a good fit?</h3>
              <ul className="mt-3 space-y-3">
                {content.goodFit.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm leading-relaxed text-primary-900">
                    <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-slate-100 bg-slate-50 px-6 py-16 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">Other types</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
              Not quite what you had in mind?
            </h2>
          </Reveal>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {otherTypes.map((other, i) => (
              <Reveal key={other.slug} delayMs={i * 75}>
                <Link href={`/waqf-types/${other.slug}`} className="group block h-full">
                  <Card tone="neutral" className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
                    <span
                      className="mb-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-100"
                      aria-hidden="true"
                    >
                      <other.icon className="h-4.5 w-4.5" />
                    </span>
                    <h3 className="text-sm font-semibold text-slate-900">{other.label}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{other.summary}</p>
                  </Card>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-24 pt-16 sm:px-8">
        <Reveal className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden rounded-2xl px-8 py-14 text-center sm:px-16" style={{ backgroundImage: GRADIENT }}>
            <div
              className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl"
              aria-hidden="true"
            />
            <h2 className="relative text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Ready to establish your {content.label} Fund?
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
