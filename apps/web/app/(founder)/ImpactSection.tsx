"use client";

// Homepage "Our impact" band. Dark brand-green section: a centred headline,
// then a WALL OF REAL FIELD PHOTOS, then one white stat card carrying the
// real numbers.
//
// The photos are the ones taken when Vault money was actually delivered or a
// project step executed (backend: FieldPhotosService). They arrive here
// automatically — a photo shows up by itself once the delivery it documents
// is paid or the milestone is completed; nobody picks them for the homepage.
// Each one links to the vault it came from, so a visitor can follow a picture
// to the campaign and the proof behind it. With many photos the wall is two
// rows drifting in opposite directions (paused on hover, static under
// prefers-reduced-motion); with a few it's a plain grid; with none yet it
// shows three labelled illustrations instead — never an empty hole.
//
// Every figure comes from GET /impact/summary (live records — see the backend
// ImpactService); nothing is typed in by hand. page.tsx only passes data in
// (via visibleImpact) once there's enough real giving to show, and a stat with
// no data yet (e.g. nothing paid out so far) is left out rather than shown as
// a zero, so the card always divides evenly. Violet is deliberately absent:
// it's reserved for the AI surface (see styles.css).
import Link from "next/link";
import { useState, type ComponentType, type ReactNode } from "react";
import { IconBriefcase, IconCheckCircle, IconLandmark, IconSparkle } from "@birr/ui";
import {
  formatCompactMoney,
  splitCurrencies,
  type CurrencyTotal,
  type FieldPhoto,
  type ImpactSummary,
} from "../../lib/impact-api";
import { Reveal } from "./SiteChrome";
import { AssetIllustration, InvestmentIllustration, ProjectIllustration } from "./waqf-types/illustrations";

/** At or above this many photos the wall becomes two scrolling rows; below it, a static grid. */
export const MARQUEE_MIN_PHOTOS = 8;
/** Each half of a scrolling row must hold at least this many tiles, or the loop would show a gap on a wide screen. */
const MIN_TILES_PER_HALF = 10;

const KIND_LABEL: Record<FieldPhoto["kind"], string> = { delivery: "Delivered", milestone: "Milestone reached" };

// Tile widths cycle so the wall has rhythm instead of a rigid row of identical boxes.
const TILE_WIDTHS = ["w-64", "w-80", "w-56", "w-72"] as const;

const ILLUSTRATIONS: { Illustration: ComponentType<{ className?: string }>; label: string }[] = [
  { Illustration: InvestmentIllustration, label: "Investment funds" },
  { Illustration: AssetIllustration, label: "Asset funds" },
  { Illustration: ProjectIllustration, label: "Project funds" },
];

// Literal class names (not built from a variable) so Tailwind can see them.
const STAT_COLUMNS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
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
  icon: ComponentType<{ className?: string }>;
  note?: ReactNode;
}

function others(list: CurrencyTotal[]): ReactNode {
  if (list.length === 0) return undefined;
  return (
    <span className="inline-block rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-800">
      + {list.map(formatCompactMoney).join(", ")}
    </span>
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
              className={`h-52 sm:h-60 ${TILE_WIDTHS[i % TILE_WIDTHS.length]}`}
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
      <div className="space-y-4">
        <MarqueeRow photos={top} />
        <MarqueeRow photos={bottom} reverse />
      </div>
    );
  }
  if (photos.length > 0) {
    return (
      <div className={`mx-auto grid max-w-6xl grid-cols-2 gap-4 px-6 sm:px-8 md:grid-cols-3 ${GRID_COLUMNS[Math.min(photos.length, 4)]}`}>
        {photos.map((photo) => (
          <PhotoTile key={photo.id} photo={photo} className="aspect-[4/3]" />
        ))}
      </div>
    );
  }
  // No field photos yet: three labelled illustrations, one per kind of fund — a real, honest placeholder.
  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-6 sm:grid-cols-3 sm:px-8">
      {ILLUSTRATIONS.map(({ Illustration, label }) => (
        <div key={label} className="flex aspect-[4/3] flex-col rounded-3xl bg-gradient-to-br from-primary-50 via-white to-accent-50 p-5 shadow-xl shadow-black/25 ring-1 ring-white/15">
          <div className="flex min-h-0 flex-1 items-center justify-center" aria-hidden="true">
            <Illustration className="h-full w-full" />
          </div>
          <span className="self-start rounded-full bg-primary-900 px-3 py-1 text-xs font-semibold text-white">{label}</span>
        </div>
      ))}
    </div>
  );
}

export function ImpactSection({ impact, photos }: { impact: ImpactSummary | null; photos: FieldPhoto[] }) {
  if (!impact) return null;

  const given = splitCurrencies(impact.givenByCurrency);
  const paid = splitCurrencies(impact.paidOutByCurrency);
  const stats: Stat[] = [
    { value: impact.giftsReceived.toLocaleString("en-NG"), label: "Gifts received", icon: IconSparkle },
    ...(given.lead
      ? [{ value: formatCompactMoney(given.lead), label: "Given so far", icon: IconLandmark, note: others(given.others) }]
      : []),
    { value: impact.fundsAndCampaigns.toLocaleString("en-NG"), label: "Waqf Funds & campaigns", icon: IconBriefcase },
    ...(paid.lead
      ? [{ value: formatCompactMoney(paid.lead), label: "Paid out to causes", icon: IconCheckCircle, note: others(paid.others) }]
      : []),
  ];

  return (
    <section id="impact" className="relative isolate overflow-hidden bg-primary-950 py-20 text-white sm:py-28">
      {/* Backdrop: a faint dot grid and two soft glows — gold top-right, green bottom-left. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-60 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] [background-size:26px_26px]"
      />
      <div aria-hidden="true" className="absolute -right-24 -top-32 -z-10 h-96 w-96 rounded-full bg-accent-400/20 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-32 -left-24 -z-10 h-[28rem] w-[28rem] rounded-full bg-primary-500/25 blur-3xl" />

      <Reveal className="mx-auto max-w-3xl px-6 text-center sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent-300">Our impact</p>
        <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Giving you can <span className="text-accent-300">verify.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-primary-100/85">
          {photos.length > 0
            ? "These photos were taken when gifts were delivered and project steps completed. Open any one to see the campaign and the proof behind it."
            : "Every figure on this page is counted live from Birr's own records — confirmed gifts only, with each currency shown on its own."}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/vaults"
            className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-3 text-sm font-semibold text-primary-900 shadow-sm transition hover:bg-primary-50"
          >
            Browse open Vaults
          </Link>
          <Link href="/#governance" className="inline-flex items-center justify-center text-sm font-semibold text-primary-100 transition hover:text-white">
            How every decision is checked <span aria-hidden="true" className="ml-1.5">→</span>
          </Link>
        </div>
      </Reveal>

      <Reveal delayMs={120} className="mt-12 sm:mt-16">
        <PhotoWall photos={photos} />
      </Reveal>

      <Reveal delayMs={200} className="mx-auto mt-14 max-w-6xl px-6 sm:mt-20 sm:px-8">
        <div
          className={`grid divide-y divide-slate-200 overflow-hidden rounded-3xl bg-white text-slate-900 shadow-2xl shadow-black/30 md:divide-x md:divide-y-0 ${STAT_COLUMNS[stats.length] ?? "md:grid-cols-4"}`}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center px-6 py-7 text-center sm:py-10">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <stat.icon className="h-5 w-5" />
              </span>
              <p className="mt-4 text-4xl font-semibold tabular-nums tracking-tight text-primary-900 lg:text-5xl">{stat.value}</p>
              <p className="mt-2 text-sm font-medium text-slate-700">{stat.label}</p>
              {stat.note && <div className="mt-2">{stat.note}</div>}
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-primary-200/80">
          Refreshed every few minutes · refunded, held and unconfirmed gifts are never counted · currencies are never converted
        </p>
      </Reveal>
    </section>
  );
}
