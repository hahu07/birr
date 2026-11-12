"use client";

// Public zakah calculator. Downloads only what Birr's staff control —
// the Shariah-board-approved rulesets and the Compliance-approved metal
// prices (GET /zakah/rulesets/current, /zakah/metal-prices/current) —
// and does the arithmetic in the browser (ZakahCalculator.tsx), so a
// visitor's figures never leave their device.
import { useCallback, useEffect, useState } from "react";
import type { MetalPrices, ZakahRuleset } from "@birr/zakah";
import { ApiError, apiFetchJson } from "../../../lib/api";
import { Alert, Button, Skeleton } from "@birr/ui";
import { Reveal, SiteFooter, SiteHeader } from "../SiteChrome";
import { ZakahCalculator } from "./ZakahCalculator";
import type { ZakahPaymentTerms } from "./PayZakahForm";
import { FitrSection, type FitrCampaignPublic } from "./FitrSection";

type Loaded =
  | { state: "loading" }
  | { state: "error" }
  | { state: "unavailable"; reason: "no_rulesets" | "no_prices" }
  | { state: "ready"; rulesets: ZakahRuleset[]; prices: MetalPrices; paymentTerms: ZakahPaymentTerms | null };

type FitrLoaded = { campaign: FitrCampaignPublic; rulesets: ZakahRuleset[]; paymentTerms: ZakahPaymentTerms | null } | null;

/** Today in Nigeria, which is what Birr dates its prices by. */
function lagosToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

export default function ZakahCalculatorPage() {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // Zakah al-Fitr doesn't depend on the calculator's prices, so it's loaded
  // and shown on its own — it still works if prices are out of date.
  const [fitr, setFitr] = useState<FitrLoaded>(null);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<ZakahRuleset[]>("/zakah/rulesets/current"),
      apiFetchJson<MetalPrices>("/zakah/metal-prices/current").catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
      // Paying is optional to the page: without the terms the calculator still works.
      apiFetchJson<ZakahPaymentTerms>("/zakah-payments/terms").catch(() => null),
    ])
      .then(([rulesets, prices, paymentTerms]) => {
        if (rulesets.length === 0) setLoaded({ state: "unavailable", reason: "no_rulesets" });
        else if (!prices) setLoaded({ state: "unavailable", reason: "no_prices" });
        else
          setLoaded({
            state: "ready",
            rulesets,
            prices: { goldPerGram: prices.goldPerGram, silverPerGram: prices.silverPerGram, asOf: prices.asOf, source: prices.source },
            paymentTerms,
          });
      })
      .catch(() => setLoaded({ state: "error" }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      apiFetchJson<FitrCampaignPublic>("/zakah/fitr-campaigns/current"),
      apiFetchJson<ZakahRuleset[]>("/zakah/rulesets/current").catch(() => [] as ZakahRuleset[]),
      apiFetchJson<ZakahPaymentTerms>("/zakah-payments/terms").catch(() => null),
    ])
      .then(([campaign, rulesets, paymentTerms]) => setFitr({ campaign, rulesets, paymentTerms }))
      // No campaign approved yet (404) or unreachable: the section just isn't shown.
      .catch(() => setFitr(null));
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <section className="px-4 pb-16 pt-12 sm:px-8 sm:pt-16">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">Zakah calculator</p>
          <h1 className="font-display mt-3 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">
            Work out your zakah in Naira.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Enter what you own and what you owe. We compare it with today&apos;s nisab and show exactly how we reached the
            figure. Your numbers stay on your device.
          </p>
        </Reveal>

        <div className="mx-auto mt-10 max-w-5xl">
          {loaded.state === "loading" && (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          )}

          {loaded.state === "error" && (
            <Alert tone="danger" title="We couldn't load the calculator">
              <p className="mb-3">Check your connection and try again.</p>
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            </Alert>
          )}

          {loaded.state === "unavailable" && (
            <Alert tone="info" title="The calculator isn't open yet">
              {loaded.reason === "no_rulesets"
                ? "It opens once Birr's Shariah Supervisory Board has approved the rulings it applies."
                : "It opens once today's gold and silver prices have been approved, since they set the nisab."}
            </Alert>
          )}

          {loaded.state === "ready" && (
            <ZakahCalculator rulesets={loaded.rulesets} prices={loaded.prices} today={lagosToday()} paymentTerms={loaded.paymentTerms} />
          )}
        </div>

        {fitr && <FitrSection campaign={fitr.campaign} rulesets={fitr.rulesets} paymentTerms={fitr.paymentTerms} />}

        <p className="mx-auto mt-12 max-w-2xl text-center text-xs leading-relaxed text-slate-500">
          This calculator covers cash, savings, business stock, money owed to you, and gold and silver. Livestock, crops, shares,
          pensions and crypto have their own rules and aren&apos;t included yet.
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}
