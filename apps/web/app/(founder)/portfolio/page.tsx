"use client";

// Portfolio — the actual Foundation/Waqf Fund breakdown (the Overview is
// a summary, not a working list). Each Waqf Fund row here is a
// lightweight summary; its full breakdown lives on /portfolio/[id].
// Establishment (new Foundation, new Waqf Fund) is Founder self-service,
// immediate, no approval gate.
//
// 2026-10 redesign: built from GET /foundations as well as GET /waqfs —
// grouping the fund list alone silently dropped any Foundation with no
// Waqf Fund yet, the one Foundation a Founder most needs to see (to add
// its first fund). Each Foundation is now its own card, with its deed
// status and actions in the header.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney, humanize } from "../../../lib/format";
import type { Foundation, Waqf } from "../../../lib/types";
import { Alert, IconCheckCircle, IconFileText, IconLandmark, IconPlus, Input, Skeleton } from "@birr/ui";
import { FundRow, linkButton, PageHeader, Panel } from "../_components/ui";

type StatusFilter = "all" | Waqf["status"];

export default function PortfolioPage() {
  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [foundations, setFoundations] = useState<Foundation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetchJson<Waqf[]>("/waqfs"), apiFetchJson<Foundation[]>("/foundations")])
      .then(([w, f]) => {
        if (cancelled) return;
        setWaqfs(w);
        setFoundations(f);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only the statuses actually present get a filter chip.
  const statusCounts = useMemo(() => {
    const counts = new Map<Waqf["status"], number>();
    for (const w of waqfs ?? []) counts.set(w.status, (counts.get(w.status) ?? 0) + 1);
    return counts;
  }, [waqfs]);

  // Matching a foundation's name keeps every one of its waqfs (so
  // searching a Foundation's name surfaces its whole portfolio), while
  // matching a specific waqf keeps just that one under its foundation
  // heading — same behavior as the Ops Console's own Waqf Funds search.
  const query = search.trim().toLowerCase();
  const filtering = query !== "" || status !== "all";
  const groups = useMemo(() => {
    if (!waqfs || !foundations) return [];
    return foundations
      .map((foundation) => {
        const foundationMatches = query !== "" && foundation.name.toLowerCase().includes(query);
        const funds = waqfs.filter(
          (w) =>
            w.foundationId === foundation.id &&
            (status === "all" || w.status === status) &&
            (!query || foundationMatches || w.name.toLowerCase().includes(query) || w.type.includes(query)),
        );
        return { foundation, funds };
      })
      .filter((g) => !filtering || g.funds.length > 0);
  }, [waqfs, foundations, query, status, filtering]);

  const loading = !error && (waqfs === null || foundations === null);
  const empty = !loading && !error && foundations !== null && foundations.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow="Portfolio"
        title="Your endowments"
        description="Every Foundation and Waqf Fund established under your account — Birr serves as Mutawalli for each."
        actions={
          <Link href="/foundations/new" className={linkButton.secondary}>
            <IconPlus className="h-4 w-4" />
            New Foundation
          </Link>
        }
      />

      {error && (
        <Alert tone="danger" title="Couldn't load your portfolio" className="mb-6">
          {error}
        </Alert>
      )}

      {loading && <PortfolioSkeleton />}

      {empty && (
        <Panel className="p-8 text-center sm:p-12">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
            <IconLandmark className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl font-medium text-slate-900">No Foundation yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Establish a Foundation to get started — you can add Waqf Funds under it right away.
          </p>
          <Link href="/foundations/new" className={`${linkButton.primary} mt-6`}>
            Establish a Foundation
          </Link>
        </Panel>
      )}

      {!loading && !error && !empty && (
        <>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              <FilterChip label="All" count={waqfs!.length} active={status === "all"} onClick={() => setStatus("all")} />
              {[...statusCounts.entries()].map(([s, n]) => (
                <FilterChip key={s} label={humanize(s)} count={n} active={status === s} onClick={() => setStatus(s)} />
              ))}
            </div>
            <Input
              type="search"
              placeholder="Search funds or foundations…"
              aria-label="Search funds or foundations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:w-72"
            />
          </div>

          {groups.length === 0 ? (
            <Panel className="px-5 py-10 text-center">
              <p className="text-sm text-slate-600">No waqf funds match your filters.</p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                }}
                className="mt-3 text-sm font-semibold text-primary-700 hover:text-primary-800"
              >
                Clear filters
              </button>
            </Panel>
          ) : (
            <div className="space-y-6">
              {groups.map(({ foundation, funds }) => (
                <FoundationCard key={foundation.id} foundation={foundation} funds={funds} totalFunds={waqfs!.filter((w) => w.foundationId === foundation.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-primary-800 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className={`tabular-nums ${active ? "text-primary-200" : "text-slate-400"}`}>{count}</span>
    </button>
  );
}

/**
 * Raised per currency across the Foundation's funds — never added across
 * currencies (see DashboardOverview's positionsByCurrency for the same rule).
 */
function raisedByCurrency(funds: Waqf[]): { currency: string; raised: number; declared: number }[] {
  const map = new Map<string, { currency: string; raised: number; declared: number }>();
  for (const w of funds) {
    if (!w.corpusCurrency) continue;
    const e = map.get(w.corpusCurrency) ?? { currency: w.corpusCurrency, raised: 0, declared: 0 };
    e.raised += Number(w.amountRaised ?? 0);
    e.declared += Number(w.corpusAmount ?? 0);
    map.set(w.corpusCurrency, e);
  }
  return [...map.values()];
}

function FoundationCard({ foundation, funds, totalFunds }: { foundation: Foundation; funds: Waqf[]; totalFunds: Waqf[] }) {
  const totals = raisedByCurrency(totalFunds);
  return (
    <Panel>
      <div className="flex flex-col gap-4 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
            <IconLandmark className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <Link href={`/foundations/${foundation.id}`} className="hover:underline">
              <h2 className="break-words text-base font-semibold text-slate-900">{foundation.name}</h2>
            </Link>
            <p className="mt-0.5 text-xs text-slate-500">
              {[foundation.purpose, foundation.jurisdiction].filter(Boolean).join(" · ") || "Foundation"}
              {" · "}
              {totalFunds.length} {totalFunds.length === 1 ? "fund" : "funds"}
              {totals.map((t) => (
                <span key={t.currency}>
                  {" · "}
                  <span className="font-semibold tabular-nums text-slate-700">{formatMoney(t.raised, t.currency, { decimals: 0 })}</span> raised
                </span>
              ))}
            </p>
            <div className="mt-2.5">
              <DeedStatus foundation={foundation} />
            </div>
          </div>
        </div>
        <FoundationActions foundationId={foundation.id} />
      </div>
      {funds.length === 0 ? (
        <div className="px-5 py-6 text-sm text-slate-600">
          No Waqf Fund under this Foundation yet.{" "}
          <Link href={`/foundations/${foundation.id}/waqf-funds/new`} className="font-semibold text-primary-700 hover:text-primary-800">
            Add the first one →
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {funds.map((w) => (
            <li key={w.id}>
              <FundRow waqf={w} showFoundation={false} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FoundationActions({ foundationId }: { foundationId: string }) {
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <Link href={`/foundations/${foundationId}`} className={`${linkButton.secondary} px-3 py-2 text-xs`}>
        View Foundation
      </Link>
      <Link href={`/foundations/${foundationId}/waqf-funds/new`} className={`${linkButton.primary} px-3 py-2 text-xs`}>
        <IconPlus className="h-3.5 w-3.5" />
        Add Waqf Fund
      </Link>
    </div>
  );
}

/** Signed (with date) or a link to sign — the Foundation-level deed covers every fund under it. */
function DeedStatus({ foundation }: { foundation: Foundation }) {
  if (foundation.foundationDeed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-800 ring-1 ring-inset ring-primary-200">
        <IconCheckCircle className="h-3.5 w-3.5" />
        Deed signed {formatDate(foundation.foundationDeed.signedAt)}
      </span>
    );
  }
  return (
    <Link
      href={`/foundations/${foundation.id}/deed`}
      className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-800 ring-1 ring-inset ring-accent-200 hover:bg-accent-100"
    >
      <IconFileText className="h-3.5 w-3.5" />
      Deed not signed — sign now
    </Link>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your portfolio">
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-56 w-full rounded-2xl" />
      ))}
    </div>
  );
}
