"use client";

// Homepage "Our impact" band: four big, real numbers flanked by tilted
// picture frames. Every figure comes from GET /impact/summary (live
// records, see the backend ImpactService) — nothing here is typed in by
// hand, and the section is only given data (by page.tsx, via visibleImpact) once
// there's enough real giving to show. Frames show real Vault cover photos when
// there are any, and fall back to Birr's own illustrations otherwise.
import type { ReactNode } from "react";
import {
  formatCompactMoney,
  splitCurrencies,
  type CurrencyTotal,
  type ImpactPhoto,
  type ImpactSummary,
} from "../../lib/impact-api";
import { Reveal } from "./SiteChrome";
import { AssetIllustration, InvestmentIllustration, ProjectIllustration } from "./waqf-types/illustrations";

// Alternating tilt, like a pinned photo — left pair tilts one way, right pair the other.
const FRAMES = [
  { position: "left-0 top-6", tilt: "-rotate-6", size: "h-44 w-44" },
  { position: "left-10 top-52", tilt: "rotate-3", size: "h-40 w-40" },
  { position: "right-0 top-4", tilt: "rotate-6", size: "h-40 w-40" },
  { position: "right-8 top-52", tilt: "-rotate-3", size: "h-44 w-44" },
] as const;

const FALLBACKS = [InvestmentIllustration, AssetIllustration, ProjectIllustration, InvestmentIllustration];

function Stat({ value, label, note }: { value: string; label: string; note?: ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-4xl font-semibold tracking-tight text-primary-700 sm:text-5xl">{value}</p>
      <p className="mt-2 text-sm font-medium text-slate-800">{label}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function others(list: CurrencyTotal[]): string | undefined {
  return list.length > 0 ? `plus ${list.map(formatCompactMoney).join(", ")}` : undefined;
}

export function ImpactSection({
  impact,
  photos,
  covers,
}: {
  impact: ImpactSummary | null;
  photos: ImpactPhoto[];
  covers: string[];
}) {
  if (!impact) return null;
  // Real approved photos first (with their real description), then Vault covers (decorative).
  const pictures = [
    ...photos.map((p) => ({ src: p.imageUrl, alt: p.altText })),
    ...covers.map((src) => ({ src, alt: "" })),
  ].slice(0, FRAMES.length);

  const given = splitCurrencies(impact.givenByCurrency);
  const paid = splitCurrencies(impact.paidOutByCurrency);
  const stats: { value: string; label: string; note?: ReactNode }[] = [
    { value: impact.giftsReceived.toLocaleString("en-NG"), label: "Gifts received" },
    ...(given.lead ? [{ value: formatCompactMoney(given.lead), label: "Given so far", note: others(given.others) }] : []),
    { value: impact.fundsAndCampaigns.toLocaleString("en-NG"), label: "Waqf Funds & campaigns" },
    ...(paid.lead ? [{ value: formatCompactMoney(paid.lead), label: "Paid out to causes", note: others(paid.others) }] : []),
  ];

  return (
    <section id="impact" className="overflow-hidden px-6 py-24 sm:px-8">
      <div className="relative mx-auto max-w-5xl">
        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          {FRAMES.map((frame, i) => {
            const picture = pictures[i];
            const Fallback = FALLBACKS[i];
            return (
              <div
                key={i}
                className={`absolute ${frame.position} ${frame.size} ${frame.tilt} overflow-hidden rounded-2xl border-2 border-primary-600 bg-primary-50 shadow-lg shadow-primary-900/10`}
              >
                {picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={picture.src} alt={picture.alt} className="h-full w-full object-cover" />
                ) : (
                  <span aria-hidden="true">
                    <Fallback className="h-full w-full" />
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <Reveal className="relative mx-auto max-w-xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">Our impact</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Making a difference, together.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Real numbers, counted live from Birr's own records — confirmed gifts only, with each currency shown on
            its own.
          </p>
        </Reveal>

        {/* A tile with no data yet (e.g. nothing paid out so far) is simply
            left out rather than shown as a zero — and an odd one out is
            centred so the grid never looks lopsided. */}
        <Reveal delayMs={100} className="relative mx-auto mt-14 grid max-w-xl grid-cols-2 gap-x-6 gap-y-12">
          {stats.map((stat, i) => (
            <div key={stat.label} className={stats.length % 2 === 1 && i === stats.length - 1 ? "col-span-2" : ""}>
              <Stat {...stat} />
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
