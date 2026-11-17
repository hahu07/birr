"use client";

// The public list of Birr's clinic waqfs (/clinics): the way in from the
// site's menu to each clinic's own giving and report page. Every
// established clinic is listed, marked "Taking gifts" or "Opening soon"
// (an approved deed and the clinic waqf's Paystack subaccount, the same
// test the clinic's page uses). Data from @Public() GET /clinics.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Alert, Badge, Button, IconHeart, Skeleton } from "@birr/ui";
import { Reveal, SiteFooter, SiteHeader } from "../SiteChrome";

interface PublicClinic {
  name: string;
  slug: string;
  city: string;
  description: string | null;
  available: boolean;
}

export default function ClinicsIndexPage() {
  const [clinics, setClinics] = useState<PublicClinic[] | null>(null);
  // A failed fetch is not the same as nothing being open; say which.
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<PublicClinic[]>("/clinics")
      .then((data) => {
        setClinics(data);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <section className="px-6 pb-16 pt-16 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">Clinics</p>
          <h1 className="font-display mt-3 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">
            Care for women and young children, held in waqf.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Each clinic is a laboratory and clinic held in its own waqf, with Birr as trustee and a licensed operator
            running it. Endow it, and your gift is kept for ever; or give to its running costs. Founders and anyone else
            can give.
          </p>
        </Reveal>

        <h2 className="sr-only">Clinics</h2>

        {clinics === null && !loadError && (
          <div className="mx-auto mt-10 max-w-3xl space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {loadError && (
          <div className="mx-auto mt-10 max-w-md">
            <Alert tone="danger" title="Couldn't load the clinics">
              Something went wrong reaching Birr. This isn&apos;t the same as there being no clinics. Try again in a moment.
            </Alert>
            <Button type="button" className="mt-4 w-full" onClick={load}>
              Try again
            </Button>
          </div>
        )}

        {clinics !== null && !loadError && clinics.length === 0 && (
          <p className="mx-auto mt-12 max-w-md text-center text-sm text-slate-500">No clinic is open yet. Please check back soon.</p>
        )}

        {clinics !== null && !loadError && clinics.length > 0 && (
          <ul className="mx-auto mt-10 max-w-3xl divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {clinics.map((c) => (
              <li key={c.slug}>
                <Link href={`/clinics/${c.slug}`} className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-slate-50">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300">
                    <IconHeart className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-medium text-slate-900">{c.name}</span>
                      <Badge tone={c.available ? "success" : "neutral"}>{c.available ? "Taking gifts" : "Opening soon"}</Badge>
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-500">{c.city}</span>
                    {c.description && <span className="mt-1 block text-sm leading-relaxed text-slate-600">{c.description}</span>}
                  </span>
                  <span className="mt-2 shrink-0 text-sm font-medium text-primary-700" aria-hidden>
                    View →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}
