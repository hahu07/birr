"use client";

// Founder-facing, read-only (2026-09-15) — a Project-type Waqf Fund's
// milestone timeline: name, status, and (unlike Vault's anonymous
// public donor page) full budget-vs-actual and evidence, since the
// Founder established this fund and is exactly who this proof of
// completed work is for. Marking one "completed" is always the
// governed waqf.milestone_complete action, decided by Birr staff on the
// Approval Queue — nothing here proposes or decides anything.
import { useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount } from "../../../../lib/format";
import type { WaqfMilestone } from "../../../../lib/types";
import { Alert, IconFileText, Skeleton } from "@birr/ui";

export function ProjectProgressSection({ waqfId, currency }: { waqfId: string; currency: string }) {
  const [milestones, setMilestones] = useState<WaqfMilestone[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<WaqfMilestone[]>(`/waqf-milestones?waqfId=${waqfId}`)
      .then((data) => {
        if (!cancelled) setMilestones(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  if (error) {
    return (
      <div className="mt-5 border-t border-slate-100 pt-5">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Project progress</p>
        <Alert tone="danger" title="Couldn't load project progress">
          {error}
        </Alert>
      </div>
    );
  }

  if (milestones === null) {
    return (
      <div className="mt-5 border-t border-slate-100 pt-5">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Project progress</p>
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (milestones.length === 0) return null;

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Project progress</p>
      <p className="mb-3 text-sm text-slate-500">
        A distribution against a milestone can only happen once it's marked completed — a maker-checker decision by
        Birr's staff.
      </p>
      <ol className="space-y-3">
        {milestones.map((m) => (
          <li key={m.id} className="text-sm">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  m.status === "completed"
                    ? "bg-primary-600 text-white"
                    : m.status === "in_progress"
                      ? "bg-accent-100 text-accent-700 ring-1 ring-inset ring-accent-300"
                      : "bg-slate-100 text-slate-400 ring-1 ring-inset ring-slate-200"
                }`}
                aria-hidden="true"
              >
                {m.status === "completed" ? "✓" : m.sequence}
              </span>
              <span className={m.status === "completed" ? "font-medium text-slate-900" : "text-slate-600"}>{m.name}</span>
              <span className="text-xs text-slate-400">
                ({m.status === "completed" ? "Done" : m.status === "in_progress" ? "In progress" : "Upcoming"})
              </span>
            </div>
            <div className="ml-[30px] mt-1">
              <BudgetVsActual milestone={m} currency={currency} />
              {m.description && <p className="mt-0.5 text-xs text-slate-500">{m.description}</p>}
              {(m.evidenceNotes || m.evidenceFileUrl) && (
                <div className="mt-1.5">
                  {m.evidenceNotes && <p className="text-xs leading-relaxed text-slate-500">{m.evidenceNotes}</p>}
                  {m.evidenceFileUrl && (
                    <a
                      href={m.evidenceFileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800"
                    >
                      <IconFileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      View evidence →
                    </a>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// See VaultMilestonesSection.tsx's own BudgetVsActual for the same
// primary-currency-vs-other-currencies reasoning — a milestone's
// expenses aren't currency-locked the same way its own targetAmount is.
function BudgetVsActual({ milestone, currency }: { milestone: WaqfMilestone; currency: string }) {
  const spent = Number(milestone.actualSpend.find((s) => s.currency === currency)?.amount ?? "0");
  const otherSpend = milestone.actualSpend.filter((s) => s.currency !== currency && Number(s.amount) > 0);
  const target = milestone.targetAmount ? Number(milestone.targetAmount) : null;

  if (target === null && spent === 0 && otherSpend.length === 0) return null;

  const overBudget = target !== null && spent > target;

  return (
    <div className="text-xs">
      {target !== null ? (
        <p className={overBudget ? "font-semibold text-red-600" : "text-slate-500"}>
          {currency} {formatAmount(spent)} of {formatAmount(target)} spent
        </p>
      ) : spent > 0 ? (
        <p className="text-slate-500">
          {currency} {formatAmount(spent)} spent
        </p>
      ) : null}
      {otherSpend.length > 0 && (
        <p className="mt-0.5 text-slate-400">+ {otherSpend.map((s) => `${s.currency} ${formatAmount(s.amount)}`).join(" · ")}</p>
      )}
    </div>
  );
}
