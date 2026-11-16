"use client";

// Roles & Access, rebuilt 2026-11-16 (owner's decisions): what each staff
// role may do, who holds it, changes and their history, and the periodic
// access review. Staff managers only (roles.view). Grants change only
// through the governed role.permission_change: a platform admin stages
// changes here and sends them, with a reason, as one proposal; a Board
// member approves or rejects the set on the Approvals page.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, apiFetchJson } from "../../../lib/api";
import { useStaffSession } from "../../../lib/staff-session";
import { ROLE_ORDER } from "../../../lib/permission-labels";
import type { AccessReviewsStatus, GrantChange, RoleChanges, RolesOverview } from "../../../lib/ops-types";
import { Alert, Button, IconKey, Skeleton, Tabs } from "@birr/ui";
import { ByRoleTab } from "./ByRoleTab";
import { ByPermissionTab } from "./ByPermissionTab";
import { ChangesTab } from "./ChangesTab";
import { AccessReviewsTab } from "./AccessReviewsTab";
import { StagedChangesBar } from "./StagedChangesBar";
import { stageKey } from "./staging";

type TabKey = "roles" | "permissions" | "changes" | "reviews";
const TAB_KEYS: TabKey[] = ["roles", "permissions", "changes", "reviews"];

export default function RolesPage() {
  const { can } = useStaffSession();
  const [overview, setOverview] = useState<RolesOverview | null>(null);
  const [changes, setChanges] = useState<RoleChanges | null>(null);
  const [reviews, setReviews] = useState<AccessReviewsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("roles");
  const [staged, setStaged] = useState<Map<string, GrantChange>>(new Map());
  const [sent, setSent] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canEdit = can("role.permission_change");
  const canReview = can("roles.access_review");

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<RolesOverview>("/roles"),
      apiFetchJson<RoleChanges>("/roles/changes"),
      apiFetchJson<AccessReviewsStatus>("/roles/access-reviews"),
    ])
      .then(([o, c, r]) => {
        setOverview({ ...o, roles: [...o.roles].sort((a, b) => ROLE_ORDER.indexOf(a.key) - ROLE_ORDER.indexOf(b.key)) });
        setChanges(c);
        setReviews(r);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
    // A link such as the access-review reminder can open a tab directly.
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted && TAB_KEYS.includes(wanted as TabKey)) setTab(wanted as TabKey);
  }, [load]);

  /** Stages a role's grant on a permission; staging the current value back removes it. */
  const stage = useCallback(
    (change: GrantChange) => {
      setSent(false);
      setStaged((prev) => {
        const next = new Map(prev);
        const role = overview?.roles.find((r) => r.key === change.roleKey);
        const current = role?.rolePermissions.find((rp) => rp.permission.key === change.permissionKey);
        const same = (current?.canMaker ?? false) === change.canMaker && (current?.canChecker ?? false) === change.canChecker;
        if (same) next.delete(stageKey(change));
        else next.set(stageKey(change), change);
        return next;
      });
    },
    [overview],
  );

  const people = useMemo(() => new Set(Object.values(overview?.holders ?? {}).flat().map((h) => h.id)).size, [overview]);
  const reviewDue = reviews ? !reviews.nextDueAt || new Date(reviews.nextDueAt) <= new Date() : false;

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await apiFetch("/roles/export.csv");
      if (!res.ok) throw new Error("Couldn't export the access matrix.");
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "birr-access-matrix.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export the access matrix.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={staged.size > 0 ? "pb-28" : undefined}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
            <IconKey className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Roles &amp; Access</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              What each staff role may do and who holds it. Every change needs a reason and a Board member&apos;s approval.
            </p>
          </div>
        </div>
        {overview && (
          <Button variant="secondary" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        )}
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load Roles & Access" className="mb-6">
          {error}
        </Alert>
      )}

      {!error && !overview && <Skeleton className="h-64 w-full" />}

      {overview && changes && reviews && (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Roles" value={String(overview.roles.length)} />
            <Stat label="Permissions" value={String(overview.permissions.length)} />
            <Stat label="People with a role" value={String(people)} />
            <Stat label="Awaiting the Board" value={String(changes.pending.length)} onClick={() => setTab("changes")} />
            <Stat
              label="Access review"
              value={reviewDue ? "Due now" : `Due ${new Date(reviews.nextDueAt!).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
              tone={reviewDue ? "warning" : "neutral"}
              onClick={() => setTab("reviews")}
            />
          </dl>

          {sent && (
            <Alert tone="success" title="Sent for approval" className="mb-6">
              A Board member approves or rejects these changes on the <Link href="/ops/governed-actions" className="font-medium underline">Approvals</Link>{" "}
              page. Nothing changes until then.
            </Alert>
          )}

          <Tabs
            className="mb-6"
            active={tab}
            onChange={(key) => setTab(key as TabKey)}
            items={[
              { key: "roles", label: "By role" },
              { key: "permissions", label: "By permission" },
              { key: "changes", label: changes.pending.length ? `Changes (${changes.pending.length} awaiting)` : "Changes" },
              { key: "reviews", label: reviewDue ? "Access reviews (due)" : "Access reviews" },
            ]}
          />

          {tab === "roles" && <ByRoleTab overview={overview} staged={staged} onStage={stage} canEdit={canEdit} />}
          {tab === "permissions" && <ByPermissionTab overview={overview} />}
          {tab === "changes" && <ChangesTab overview={overview} changes={changes} onChanges={setChanges} />}
          {tab === "reviews" && <AccessReviewsTab overview={overview} status={reviews} canReview={canReview} onCompleted={load} />}

          {canEdit && staged.size > 0 && (
            <StagedChangesBar
              overview={overview}
              staged={[...staged.values()]}
              onDiscard={() => setStaged(new Map())}
              onUnstage={(change) => setStaged((prev) => {
                const next = new Map(prev);
                next.delete(stageKey(change));
                return next;
              })}
              onSent={() => {
                setStaged(new Map());
                setSent(true);
                load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "neutral", onClick }: { label: string; value: string; tone?: "neutral" | "warning"; onClick?: () => void }) {
  const body = (
    <>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>{value}</dd>
    </>
  );
  const className = `rounded-xl border px-4 py-3 text-left ${tone === "warning" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} transition-colors hover:border-primary-300`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
