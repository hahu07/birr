"use client";

// Public "browse all vaults" index — the stable destination every
// internal link that used to point at the homepage's own "#vaults"
// teaser section now goes to instead (nav bar, hero door, "What Birr
// manages" vault-type cards, "How it works" giver track). The homepage
// keeps its own inline teaser (MarketingHome.tsx's "Support a cause"
// section) unchanged — this page is the fuller, linkable one, not a
// replacement for it. Same @Public() GET /vaults/open this page's data
// comes from.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import type { Vault } from "../../../lib/types";
import { Skeleton } from "@birr/ui";
import { Reveal, SiteFooter, SiteHeader, VaultCard } from "../SiteChrome";

export default function VaultsIndexPage() {
  const [vaults, setVaults] = useState<Vault[] | null>(null);

  useEffect(() => {
    apiFetchJson<Vault[]>("/vaults/open")
      .then(setVaults)
      .catch(() => setVaults([]));
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
                <VaultCard vault={vault} showType />
              </Reveal>
            ))}
          </div>
        )}

      </section>

      <SiteFooter />
    </div>
  );
}
