"use client";

// Waqf Funds list — the entry point into a specific fund's Assets,
// Beneficiaries, Investments, and Distributions (see [id]/page.tsx).
// Read-only, same posture as the Foundations page: establishment is
// donor self-service, this is Birr staff's view of what's been
// established.
//
// Grouped by Foundation rather than one flat table — a Foundation is the
// umbrella a Founder establishes once; every Waqf Fund they go on to
// create lives under it (CLAUDE.md: "A Founder... establishes their own
// Foundation... and Waqf Fund(s) under it directly"). A flat list buries
// that structure and reads as unrelated rows, especially once a
// Foundation has more than one fund — grouping surfaces the real
// hierarchy: Foundation, containing Waqf Funds, each with its own Causes.
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetchJson } from "../../../lib/api";
import { humanize } from "../../../lib/format";
import type { Waqf } from "../../../lib/ops-types";
import { Badge, Card, EmptyState, IconBriefcase, IconLandmark, Alert, Input, Skeleton } from "@birr/ui";

const STATUS_TONE: Record<Waqf["status"], "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  suspended: "warning",
  dissolved: "danger",
};

interface FoundationGroup {
  foundation: Waqf["foundation"];
  waqfs: Waqf[];
}

export default function WaqfsPage() {
  return (
    <Suspense fallback={<WaqfsSkeleton />}>
      <WaqfsPageContent />
    </Suspense>
  );
}

function WaqfsPageContent() {
  // ?foundationId= — arrived here via a link from the Foundations page
  // ("click a Foundation, see its Waqf Funds"). Filtered by id, not by
  // matching the Foundation's name through the search box below: two
  // distinct Foundations can share a display name (see the grouping
  // comment above), so an id match is the only reliable way to land on
  // the *one* Foundation that was actually clicked.
  const searchParams = useSearchParams();
  const foundationIdFilter = searchParams.get("foundationId");

  const [waqfs, setWaqfs] = useState<Waqf[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<Waqf[]>("/waqfs")
      .then((data) => {
        if (!cancelled) setWaqfs(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Grouped by foundation.id, not foundation.name — two distinct
  // Foundations can share a display name (nothing enforces uniqueness),
  // and merging those into one group would misrepresent real ownership.
  // Groups sort by their most-recently-created waqf, matching list()'s
  // own newest-first ordering; waqfs within a group keep that order too.
  //
  // Search filters the underlying waqf list before grouping — a match on
  // the *foundation* name keeps every one of its waqfs (so searching a
  // Founder's name surfaces their whole portfolio), while a match on a
  // waqf's own name/type/jurisdiction keeps just that fund under its
  // foundation heading for context. A foundation with no matches at all
  // simply produces no group, rather than an empty one.
  const query = search.trim().toLowerCase();
  const groups = useMemo<FoundationGroup[]>(() => {
    if (!waqfs) return [];
    let filtered = waqfs;
    if (query) {
      filtered = filtered.filter(
        (w) =>
          w.name.toLowerCase().includes(query) ||
          w.foundation.name.toLowerCase().includes(query) ||
          w.type.toLowerCase().includes(query) ||
          w.jurisdiction.toLowerCase().includes(query),
      );
    } else if (foundationIdFilter) {
      filtered = filtered.filter((w) => w.foundation.id === foundationIdFilter);
    }
    const byId = new Map<string, FoundationGroup>();
    for (const waqf of filtered) {
      const existing = byId.get(waqf.foundation.id);
      if (existing) {
        existing.waqfs.push(waqf);
      } else {
        byId.set(waqf.foundation.id, { foundation: waqf.foundation, waqfs: [waqf] });
      }
    }
    return Array.from(byId.values());
  }, [waqfs, query, foundationIdFilter]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconBriefcase className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Waqf Funds</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Grouped by Foundation — open a fund to see its assets, beneficiaries, investments, and distributions.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load waqf funds" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && waqfs === null && <WaqfsSkeleton />}

      {!error && waqfs !== null && waqfs.length === 0 && (
        <EmptyState title="No waqf funds yet" description="Funds established by Founders will appear here." />
      )}

      {!error && waqfs !== null && waqfs.length > 0 && (
        <Input
          placeholder="Search by fund, foundation, type, or jurisdiction…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-xs"
        />
      )}

      {!error && foundationIdFilter && !query && groups.length > 0 && (
        <p className="mb-6 text-sm text-slate-500">
          Showing Waqf Funds for <span className="font-medium text-slate-700">{groups[0].foundation.name}</span> ·{" "}
          <Link href="/ops/waqfs" className="text-primary-700 hover:text-primary-800">
            View all Foundations
          </Link>
        </p>
      )}

      {!error && waqfs !== null && waqfs.length > 0 && groups.length === 0 && (
        <p className="text-sm text-slate-500">No waqf funds match "{search.trim()}".</p>
      )}

      {!error && groups.length > 0 && (
        <div className="space-y-6">
          {groups.map((group) => (
            <FoundationGroupCard key={group.foundation.id} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

function FoundationGroupCard({ group }: { group: FoundationGroup }) {
  // tone="primary": a soft teal-tinted shell per Foundation grouping,
  // not a plain white card — this is the structural color the earlier
  // pass intended (className-based tint classes were written here but
  // silently discarded by Card's old hardcoded bg-white; see Card.tsx).
  return (
    <Card tone="primary">
      <div className="mb-4 flex items-center gap-2.5 border-b border-primary-200/70 pb-3">
        <IconLandmark className="h-4 w-4 shrink-0 text-primary-600" />
        <h2 className="text-sm font-semibold text-slate-900">{group.foundation.name}</h2>
        <span className="text-xs text-primary-700/70">
          {group.waqfs.length} {group.waqfs.length === 1 ? "waqf fund" : "waqf funds"}
        </span>
      </div>

      <div className="divide-y divide-primary-100">
        {group.waqfs.map((waqf) => (
          <Link
            key={waqf.id}
            href={`/ops/waqfs/${waqf.id}`}
            className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:bg-primary-100/50"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-primary-700">{waqf.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {humanize(waqf.type)} · {waqf.jurisdiction}
                {typeof waqf.causesCount === "number" && (
                  <> · {waqf.causesCount} {waqf.causesCount === 1 ? "cause" : "causes"}</>
                )}
              </p>
            </div>
            <Badge tone={STATUS_TONE[waqf.status]} className="shrink-0">
              {humanize(waqf.status)}
            </Badge>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function WaqfsSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <Skeleton className="mb-4 h-4 w-40" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
