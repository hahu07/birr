"use client";

// Public "browse all vaults" index — the stable destination every
// internal link that used to point at the homepage's own "#vaults"
// teaser section now goes to instead (nav bar, hero door, "What Birr
// manages" vault-type cards, "How it works" giver track). The homepage
// keeps its own inline teaser (MarketingHome.tsx's "Support a cause"
// section) unchanged — this page is the fuller, linkable one, not a
// replacement for it. Same @Public() GET /vaults/open + GET
// /cause-categories this page's data comes from.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import type { CauseCategory, Vault } from "../../../lib/types";
import { Card, IconArchive, Skeleton } from "@birr/ui";
import { Reveal, SiteFooter, SiteHeader } from "../SiteChrome";

export default function VaultsIndexPage() {
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [causeCategories, setCauseCategories] = useState<CauseCategory[]>([]);

  useEffect(() => {
    apiFetchJson<Vault[]>("/vaults/open")
      .then(setVaults)
      .catch(() => setVaults([]));
    apiFetchJson<CauseCategory[]>("/cause-categories")
      .then(setCauseCategories)
      .catch(() => setCauseCategories([]));
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <section className="px-6 pb-16 pt-16 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">Support a cause</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Every open vault, in one place.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Each one is curated by Birr's own team and tied to one or more causes from our standard catalog. No
            account, no establishment — pick one and give directly.
          </p>
        </Reveal>

        {/* Visually hidden — the card titles below are h3s (found in a
            codebase audit: nothing between this page's one h1 and those
            h3s, an invalid skip for a screen-reader user navigating by
            heading level). This groups them under a real h2 without
            changing how the section reads visually. */}
        <h2 className="sr-only">Open vaults</h2>

        {vaults === null && (
          <div className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        )}

        {vaults !== null && vaults.length === 0 && (
          <p className="mx-auto mt-12 max-w-md text-center text-sm text-slate-500">
            No vaults are open for giving right now — check back soon.
          </p>
        )}

        {vaults !== null && vaults.length > 0 && (
          <div className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {vaults.map((vault, i) => (
              <Reveal key={vault.id} delayMs={i * 75}>
                <Card tone="neutral" className="flex h-full flex-col">
                  {vault.coverImageUrl ? (
                    <div className="-mx-6 -mt-6 mb-4 h-36 overflow-hidden rounded-t-lg bg-slate-100">
                      <img src={vault.coverImageUrl} alt={vault.name} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <span
                      className="mb-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100"
                      aria-hidden="true"
                    >
                      <IconArchive className="h-5 w-5" />
                    </span>
                  )}
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-600">{humanize(vault.type)} vault</p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">{vault.name}</h3>
                  {vault.description && <p className="mt-2 text-sm leading-relaxed text-slate-600">{vault.description}</p>}
                  {(vault.causes?.length ?? 0) > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {vault.causes!.map((c) => (
                        <span key={c.id} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {vault.targetAmount && (
                    <p className="mt-3 text-xs text-slate-500">
                      Goal: {vault.currency} {Number(vault.targetAmount).toLocaleString()}
                    </p>
                  )}
                  <Link
                    href={`/vaults/${vault.slug}`}
                    className="mt-4 inline-flex items-center justify-center rounded-md bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
                  >
                    Give to this vault
                  </Link>
                </Card>
              </Reveal>
            ))}
          </div>
        )}

        {causeCategories.length > 0 && (
          <div className="mx-auto mt-16 max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-600">One standard catalog</p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
              The same causes, whichever door you came through.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              A Founder's Waqf Fund and a public Vault both draw from this list — causes are standardized once, not
              reinvented per product.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {causeCategories.map((c) => (
                <span key={c.id} className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700">
                  {c.icon && <span aria-hidden="true">{c.icon}</span>} {c.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}
