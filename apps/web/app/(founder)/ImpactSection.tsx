"use client";

// Homepage "Our impact" band. Dark brand-green section laid out as a live
// ledger: the headline and how the figures are counted on the left, one
// framed panel of real numbers on the right, then a WALL OF REAL FIELD
// PHOTOS underneath once there are any.
//
// The photos are the ones taken when Vault money was actually delivered or a
// project step executed (backend: FieldPhotosService). They arrive here
// automatically — a photo shows up by itself once the delivery it documents
// is paid or the milestone is completed; nobody picks them for the homepage.
// Each one links to the vault it came from, so a visitor can follow a picture
// to the campaign and the proof behind it. With many photos the wall is two
// rows drifting in opposite directions (paused on hover, static under
// prefers-reduced-motion); with a few it's a plain grid; with none yet the
// wall is left out entirely — the figures panel stands on its own, rather
// than filling the space with stock art that proves nothing.
//
// Every figure comes from GET /impact/summary (live records — see the backend
// ImpactService); nothing is typed in by hand. page.tsx only passes data in
// (via visibleImpact) once there's enough real giving to show, and a stat with
// no data yet (e.g. nothing paid out so far) is left out rather than shown as
// a zero, so the panel's row always divides evenly. Violet is deliberately absent:
// it's reserved for the AI surface (see styles.css).
import Link from "next/link";
import { useState } from "react";
import { IconArrowRight, IconCheckCircle } from "@birr/ui";
import {
  formatCompactMoney,
  splitCurrencies,
  type CurrencyTotal,
  type FieldPhoto,
  type ImpactSummary,
} from "../../lib/impact-api";
import { Reveal } from "./SiteChrome";

/** At or above this many photos the wall becomes two scrolling rows; below it, a static grid. */
export const MARQUEE_MIN_PHOTOS = 8;
/** Each half of a scrolling row must hold at least this many tiles, or the loop would show a gap on a wide screen. */
const MIN_TILES_PER_HALF = 10;

const KIND_LABEL: Record<FieldPhoto["kind"], string> = { delivery: "Delivered", milestone: "Milestone reached" };

// Tile widths cycle so the wall has rhythm instead of a rigid row of identical boxes.
const TILE_WIDTHS = ["w-64", "w-80", "w-56", "w-72"] as const;

// Literal class names (not built from a variable) so Tailwind can see them.
const STAT_COLUMNS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
};
const GRID_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

interface Stat {
  value: string;
  label: string;
  /** One line on what the figure counts. */
  detail: string;
  /** Totals in other currencies, listed beside the lead one — never added to it. */
  others?: CurrencyTotal[];
}

const COUNTING_RULES = [
  "Confirmed gifts only — refunded, held and unconfirmed gifts are never counted",
  "Each currency reported on its own, never converted into another",
  "Refreshed every few minutes from Birr's own records",
];

function OtherCurrencies({ list }: { list?: CurrencyTotal[] }) {
  if (!list || list.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {list.map((total) => (
        <li key={total.currency} className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-primary-100">
          + {formatCompactMoney(total)}
        </li>
      ))}
    </ul>
  );
}

function altFor(photo: FieldPhoto): string {
  return `${KIND_LABEL[photo.kind]}: ${photo.title} — ${photo.vaultName}${photo.caption ? `. ${photo.caption}` : ""}`;
}

/** One photo, linking to the vault it came from. Renders nothing if the image can't be loaded, rather than a broken-image icon. */
function PhotoTile({ photo, className, duplicate = false }: { photo: FieldPhoto; className: string; duplicate?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Link
      href={`/vaults/${photo.vaultSlug}`}
      // The looped copy of a row is only there to make the loop seamless — keep it out of the tab order and the accessibility tree.
      aria-hidden={duplicate || undefined}
      tabIndex={duplicate ? -1 : undefined}
      className={`group relative block shrink-0 overflow-hidden rounded-2xl shadow-lg shadow-black/30 ring-1 ring-white/15 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.imageUrl}
        alt={duplicate ? "" : altFor(photo)}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-4 pb-3 pt-10">
        <span className="inline-block rounded-full bg-accent-300 px-2 py-0.5 text-[11px] font-semibold text-accent-950">
          {KIND_LABEL[photo.kind]}
        </span>
        <span className="mt-1.5 block truncate text-sm font-semibold text-white">{photo.title}</span>
        <span className="block truncate text-xs text-white/75">{photo.vaultName}</span>
      </span>
    </Link>
  );
}

/** A row of photos drifting sideways. The row's photos are repeated until a half is wide enough, then the whole set is doubled for a seamless loop. */
function MarqueeRow({ photos, reverse }: { photos: FieldPhoto[]; reverse?: boolean }) {
  const reps = Math.max(1, Math.ceil(MIN_TILES_PER_HALF / photos.length));
  const half = Array.from({ length: reps }, () => photos).flat();
  return (
    <div className="impact-marquee overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)] motion-reduce:overflow-x-auto">
      <div className="impact-marquee-track flex w-max gap-4" data-reverse={reverse ? "true" : "false"}>
        {[false, true].map((duplicate) =>
          half.map((photo, i) => (
            <PhotoTile
              key={`${duplicate ? "b" : "a"}-${photo.id}-${i}`}
              photo={photo}
              duplicate={duplicate}
              className={`h-36 sm:h-40 ${TILE_WIDTHS[i % TILE_WIDTHS.length]}`}
            />
          )),
        )}
      </div>
    </div>
  );
}

function PhotoWall({ photos }: { photos: FieldPhoto[] }) {
  if (photos.length >= MARQUEE_MIN_PHOTOS) {
    // Alternate photos between the two rows so neighbours differ.
    const top = photos.filter((_, i) => i % 2 === 0);
    const bottom = photos.filter((_, i) => i % 2 === 1);
    return (
      <div className="space-y-3">
        <MarqueeRow photos={top} />
        <MarqueeRow photos={bottom} reverse />
      </div>
    );
  }
  if (photos.length > 0) {
    return (
      <div className={`mx-auto grid max-w-6xl grid-cols-2 gap-4 px-6 sm:px-8 md:grid-cols-3 ${GRID_COLUMNS[Math.min(photos.length, 4)]}`}>
        {photos.map((photo) => (
          <PhotoTile key={photo.id} photo={photo} className="aspect-[16/10]" />
        ))}
      </div>
    );
  }
  return null;
}

export function ImpactSection({ impact, photos }: { impact: ImpactSummary | null; photos: FieldPhoto[] }) {
  if (!impact) return null;

  const given = splitCurrencies(impact.givenByCurrency);
  const paid = splitCurrencies(impact.paidOutByCurrency);
  const gifts: Stat = { value: impact.giftsReceived.toLocaleString("en-NG"), label: "Gifts received", detail: "Each one a separate, confirmed payment" };
  // The lead figure is money given when there is any; otherwise the gift count leads.
  const lead: Stat = given.lead
    ? { value: formatCompactMoney(given.lead), label: "Given so far", detail: "Confirmed gifts to Waqf Funds and Vaults, across every cause", others: given.others }
    : gifts;
  const row: Stat[] = [
    ...(given.lead ? [gifts] : []),
    { value: impact.fundsAndCampaigns.toLocaleString("en-NG"), label: "Waqf Funds & campaigns", detail: "Active endowments and Birr-run Vaults" },
    ...(paid.lead
      ? [{ value: formatCompactMoney(paid.lead), label: "Paid out to causes", detail: "Released under dual authorisation", others: paid.others }]
      : []),
  ];

  return (
    <section id="impact" className="relative isolate overflow-hidden bg-primary-950 py-16 text-white lg:py-20">
      {/* Backdrop: a faint dot grid and two soft glows — gold top-right, green bottom-left. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-60 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] [background-size:26px_26px]"
      />
      <div aria-hidden="true" className="absolute -right-24 -top-32 -z-10 h-96 w-96 rounded-full bg-accent-400/15 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-32 -left-24 -z-10 h-[28rem] w-[28rem] rounded-full bg-primary-500/20 blur-3xl" />

      <div className="mx-auto grid max-w-6xl gap-12 px-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
        <Reveal>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-300">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-300 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-300" />
            </span>
            Our impact · live
          </p>
          <h2 className="font-display mt-4 text-4xl font-medium leading-[1.08] tracking-tight text-balance sm:text-[2.75rem]">
            Giving you can <span className="italic text-accent-300">verify.</span>
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-primary-100/80">
            {photos.length > 0
              ? "These photos were taken when gifts were delivered and project steps completed. Open any one to see the campaign and the proof behind it."
              : "Every figure here is counted from Birr's own records — the same ledger our trustees and auditors work from."}
          </p>

          <ul className="mt-7 space-y-3 border-t border-white/10 pt-6">
            {COUNTING_RULES.map((rule) => (
              <li key={rule} className="flex gap-3 text-sm leading-relaxed text-primary-100/85">
                <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" />
                {rule}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/vaults"
              className="inline-flex items-center justify-center whitespace-nowrap rounded-xl bg-accent-500 px-5 py-3 text-sm font-semibold text-primary-950 shadow-lg shadow-black/20 transition-colors hover:bg-accent-300"
            >
              Browse open Vaults
            </Link>
            <Link
              href="/#governance"
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-3 text-sm font-semibold text-primary-100 transition-colors hover:text-white"
            >
              How every decision is checked <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Reveal>

        <Reveal delayMs={120}>
          <div className="overflow-hidden rounded-3xl bg-white/[0.04] shadow-2xl shadow-black/30 ring-1 ring-inset ring-white/10 backdrop-blur-sm">
            <div className="relative px-7 pb-8 pt-7 sm:px-9 sm:pt-8">
              <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-300/60 to-transparent" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-200/80">{lead.label}</p>
              <p className="font-display mt-3 text-6xl font-medium leading-none tracking-tight text-accent-300 tabular-nums sm:text-7xl">{lead.value}</p>
              <OtherCurrencies list={lead.others} />
              <p className="mt-4 text-sm text-primary-100/70">{lead.detail}</p>
            </div>
            <dl className={`grid divide-y divide-white/10 border-t border-white/10 sm:divide-x sm:divide-y-0 ${STAT_COLUMNS[row.length] ?? "sm:grid-cols-3"}`}>
              {row.map((stat) => (
                <div key={stat.label} className="flex flex-col px-7 py-6 sm:px-6">
                  <dt className="order-2 mt-2 text-sm font-medium text-white">{stat.label}</dt>
                  <dd className="order-1 font-display text-4xl font-medium leading-none tracking-tight text-white tabular-nums">{stat.value}</dd>
                  <dd className="order-3 mt-1 text-xs leading-snug text-primary-100/60">{stat.detail}</dd>
                  {stat.others && stat.others.length > 0 && (
                    <dd className="order-4">
                      <OtherCurrencies list={stat.others} />
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </div>

      {photos.length > 0 && (
        <Reveal delayMs={200} className="mt-14">
          <PhotoWall photos={photos} />
        </Reveal>
      )}
    </section>
  );
}
