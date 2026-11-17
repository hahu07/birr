"use client";

// A Founder's support for Birr's clinic waqfs (2026-11-17, clinic slice 4a):
// what they've given to each clinic's endowment and running fund, every
// gift, and where they can give. Used by /clinic-support, and as the home
// page of a Founder who joined only to support clinics.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney, humanize } from "../../../lib/format";
import { Alert, Badge, Button, Card, EmptyState, IconHeart, Skeleton } from "@birr/ui";

interface FounderClinicGifts {
  clinics: { clinic: { name: string; slug: string; city: string }; endowment: string; running: string }[];
  gifts: {
    id: string;
    clinic: { name: string; slug: string };
    pot: "endowment" | "running";
    amount: string;
    feeCover: string;
    currency: string;
    status: "pending" | "confirmed" | "failed";
    createdAt: string;
    deedVersion: number | null;
  }[];
}

interface PublicClinic {
  name: string;
  slug: string;
  city: string;
  description: string | null;
}

export function ClinicSupport() {
  const [mine, setMine] = useState<FounderClinicGifts | null>(null);
  const [clinics, setClinics] = useState<PublicClinic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiFetchJson<FounderClinicGifts>("/clinic-gifts/founder/mine"), apiFetchJson<PublicClinic[]>("/clinic-gifts/clinics")])
      .then(([m, c]) => {
        setMine(m);
        setClinics(c);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  if (error) return <Alert tone="danger" title="Couldn't load your clinic support">{error}</Alert>;
  if (!mine || !clinics) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
          <IconHeart className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Clinic support</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Laboratories and clinics for women and young children, each held in a waqf with Birr as trustee.
          </p>
        </div>
      </header>

      {mine.clinics.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {mine.clinics.map((c) => (
            <Card key={c.clinic.slug}>
              <p className="text-sm font-medium text-slate-900">{c.clinic.name}</p>
              <p className="text-xs text-slate-500">{c.clinic.city}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Endowed (kept for ever)</dt>
                  <dd className="tabular-nums font-medium text-slate-900">{formatMoney(c.endowment, "NGN")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Running fund (spent on care)</dt>
                  <dd className="tabular-nums font-medium text-slate-900">{formatMoney(c.running, "NGN")}</dd>
                </div>
              </dl>
              <Link href={`/clinics/${c.clinic.slug}`} className="mt-4 inline-block">
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  Give again
                </Button>
              </Link>
            </Card>
          ))}
        </div>
      )}

      {mine.clinics.length === 0 && (
        <Card>
          <p className="text-sm font-medium text-slate-900">Where you can give</p>
          {clinics.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No clinic is taking gifts yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {clinics.map((c) => (
                <li key={c.slug} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.city}</p>
                  </div>
                  <Link href={`/clinics/${c.slug}`}>
                    <Button className="px-3 py-1.5 text-xs">Give</Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">Your first gift to a clinic is at least ₦250,000; later gifts from ₦5,000.</p>
        </Card>
      )}

      <Card>
        <p className="mb-3 text-sm font-medium text-slate-700">Your gifts</p>
        {mine.gifts.length === 0 ? (
          <EmptyState title="No gifts yet" description="Gifts you make to a clinic appear here, with your receipt references." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {mine.gifts.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="text-slate-800">
                    {formatMoney(g.amount, g.currency)} to {g.clinic.name}&apos;s {g.pot === "endowment" ? "endowment" : "running fund"}
                    {g.deedVersion ? <span className="text-slate-500"> (deed v{g.deedVersion})</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(g.createdAt)} · reference {g.id}
                  </p>
                </div>
                <Badge tone={g.status === "confirmed" ? "success" : g.status === "failed" ? "danger" : "warning"}>{humanize(g.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
