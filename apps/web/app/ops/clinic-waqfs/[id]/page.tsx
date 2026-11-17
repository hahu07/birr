"use client";

// One clinic waqf (2026-11-17). Its deed is versioned: a Mutawalli Officer
// drafts a version, proposes it, and a Shariah board member approves it on
// the Approvals page; a version's wording never changes once drafted. With
// a deed approved, establishing it is proposed to the Board of Trustees.
// The ledger keeps the endowment (kept for ever) and the running fund
// (spent) apart; the database refuses any entry that mixes them.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ClinicGiftRow, ClinicLedger, ClinicLedgerRow, ClinicWaqf, ClinicWaqfDeed, GovernedAction } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, DetailGrid, EmptyState, Skeleton } from "@birr/ui";
import { countryLabel } from "@birr/shared";
import { AssetsCard } from "./AssetsCard";
import { SpendingCard } from "./SpendingCard";
import { InvestmentsCard } from "./InvestmentsCard";
import { PriceListCard } from "./PriceListCard";
import { ClaimsCard } from "./ClaimsCard";

const DEED_TONE: Record<ClinicWaqfDeed["status"], "success" | "warning" | "neutral" | "danger"> = {
  draft: "warning",
  approved: "success",
  superseded: "neutral",
  discarded: "neutral",
};

const DEED_TEXT_LIMIT = 20_000;

export default function ClinicWaqfPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useStaffSession();
  const [clinic, setClinic] = useState<ClinicWaqf | null>(null);
  const [ledger, setLedger] = useState<ClinicLedger | null>(null);
  const [pending, setPending] = useState<GovernedAction[] | null>(null);
  const [gifts, setGifts] = useState<ClinicGiftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<ClinicWaqf>(`/clinic-waqfs/${id}`),
      apiFetchJson<ClinicLedger>(`/clinic-waqfs/${id}/ledger`),
      apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed"),
      apiFetchJson<ClinicGiftRow[]>(`/clinic-waqfs/${id}/gifts`),
    ])
      .then(([c, l, actions, g]) => {
        setClinic(c);
        setLedger(l);
        setGifts(g);
        setPending(actions.filter((a) => a.permission.key.startsWith("clinic_waqf.")));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      load();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Alert tone="danger" title="Couldn't load this clinic waqf">
        {error}
      </Alert>
    );
  }
  if (!clinic || !ledger || !pending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
    );
  }

  const deeds = clinic.deeds as ClinicWaqfDeed[];
  const draft = deeds.find((d) => d.status === "draft");
  const approved = deeds.find((d) => d.status === "approved");
  const pendingFor = (key: string, field: string, value: string) =>
    pending.find((a) => a.permission.key === key && (a.payload as Record<string, unknown>)?.[field] === value);
  const draftProposal = draft && pendingFor("clinic_waqf.deed_approve", "deedId", draft.id);
  const establishProposal = pendingFor("clinic_waqf.establish", "clinicWaqfId", clinic.id);
  const canManage = can("clinic_waqf.manage");

  async function startDraft() {
    // Start from the latest version's wording, or the standard wording for a first draft.
    const latest = deeds.find((d) => d.status !== "discarded");
    if (latest) return setDrafting(latest.text);
    const template = await apiFetchJson<{ text: string }>(`/clinic-waqfs/${clinic!.id}/deed-template`);
    setDrafting(template.text);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/ops/clinic-waqfs" className="text-sm font-medium text-primary-700 hover:text-primary-800">
        ← Clinic Waqfs
      </Link>

      <header className="mb-6 mt-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{clinic.name}</h1>
        <Badge tone={clinic.status === "established" ? "success" : "neutral"}>{humanize(clinic.status)}</Badge>
      </header>

      {actionError && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-4">
          {actionError}
        </Alert>
      )}

      <Card>
        <DetailGrid
          columns={2}
          items={[
            { label: "City", value: clinic.city },
            { label: "Jurisdiction", value: countryLabel(clinic.jurisdiction) },
            {
              label: "Giving page",
              value:
                clinic.status === "established" ? (
                  <Link href={`/clinics/${clinic.slug}`} className="font-medium text-primary-700 hover:text-primary-800">
                    /clinics/{clinic.slug}
                  </Link>
                ) : (
                  `/clinics/${clinic.slug} (opens once established)`
                ),
            },
            { label: "Created", value: `${formatDate(clinic.createdAt)}${clinic.createdByUser ? ` by ${clinic.createdByUser.fullName}` : ""}` },
            { label: "Established", value: clinic.establishedAt ? formatDate(clinic.establishedAt) : "Not yet" },
            { label: "Deed", value: approved ? `Version ${approved.version} approved` : "No version approved yet" },
          ]}
        />
        {clinic.description && <p className="mt-5 whitespace-pre-wrap border-t border-slate-100 pt-5 text-sm text-slate-700">{clinic.description}</p>}

        {clinic.status === "draft" && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            {establishProposal ? (
              <p className="text-sm text-slate-600">
                Establishing it is waiting for the Board of Trustees in the{" "}
                <Link href="/ops/governed-actions" className="font-medium text-primary-700 hover:text-primary-800">
                  Approvals queue
                </Link>
                .
              </p>
            ) : !approved ? (
              <p className="text-sm text-slate-600">It can be proposed for establishing once a Shariah board member approves a deed version.</p>
            ) : can("clinic_waqf.establish") ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      apiFetchJson("/governed-actions", {
                        method: "POST",
                        body: JSON.stringify({ permissionKey: "clinic_waqf.establish", payload: { clinicWaqfId: clinic.id } }),
                      }),
                    )
                  }
                >
                  Propose establishing it
                </Button>
                <p className="text-xs text-slate-500">The Board of Trustees decides. Once established, it's a waqf for ever.</p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Ready for a Mutawalli Officer to propose establishing it.</p>
            )}
          </div>
        )}
      </Card>

      <Card className="mt-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-700">Deed</p>
            <p className="text-xs text-slate-500">
              Supporters accept the approved version when they endow. A version's wording never changes; a change is a new
              version, approved by a Shariah board member.
            </p>
          </div>
          {canManage && !draft && drafting === null && (
            <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" disabled={busy} onClick={() => void startDraft()}>
              Draft a new version
            </Button>
          )}
        </div>

        {drafting !== null && (
          <div className="mb-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">
              The standard wording is a draft for Legal and the Shariah Supervisory Board. Edit it here; once drafted, this version can't
              be changed.
            </p>
            <textarea
              rows={18}
              maxLength={DEED_TEXT_LIMIT}
              value={drafting}
              onChange={(e) => setDrafting(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDrafting(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !drafting.trim()}
                onClick={() =>
                  run(() => apiFetchJson(`/clinic-waqfs/${clinic.id}/deeds`, { method: "POST", body: JSON.stringify({ text: drafting }) })).then(
                    (ok) => ok && setDrafting(null),
                  )
                }
              >
                Save as draft version
              </Button>
            </div>
          </div>
        )}

        {deeds.length === 0 && drafting === null && <EmptyState title="No deed yet" description="Draft the first version from the standard wording." />}

        <ul className="divide-y divide-slate-100">
          {deeds.map((deed) => (
            <li key={deed.id} className="py-3">
              <details open={deed.status === "draft" || (deed.status === "approved" && !draft)}>
                <summary className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-800">
                    Version {deed.version}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      drafted {formatDate(deed.createdAt)}
                      {deed.createdByUser ? ` by ${deed.createdByUser.fullName}` : ""}
                      {deed.approvedAt ? `; approved ${formatDate(deed.approvedAt)}` : ""}
                    </span>
                  </span>
                  <Badge tone={DEED_TONE[deed.status]}>{humanize(deed.status)}</Badge>
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm text-slate-700">{deed.text}</pre>
                {deed.status === "draft" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {draftProposal ? (
                      <p className="text-xs text-slate-500">
                        Waiting for a Shariah board member in the{" "}
                        <Link href="/ops/governed-actions" className="font-medium text-primary-700 hover:text-primary-800">
                          Approvals queue
                        </Link>
                        .
                      </p>
                    ) : (
                      <>
                        {can("clinic_waqf.deed_approve") && (
                          <Button
                            className="px-3 py-1.5 text-xs"
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                apiFetchJson("/governed-actions", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    permissionKey: "clinic_waqf.deed_approve",
                                    payload: { deedId: deed.id, textHash: deed.textHash },
                                  }),
                                }),
                              )
                            }
                          >
                            Propose for Shariah approval
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            variant="secondary"
                            className="px-3 py-1.5 text-xs"
                            disabled={busy}
                            onClick={() => run(() => apiFetchJson(`/clinic-waqfs/${clinic.id}/deeds/${deed.id}/discard`, { method: "POST" }))}
                          >
                            Discard draft
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      </Card>

      <AssetsCard clinicWaqfId={clinic.id} established={clinic.status === "established"} />

      <SpendingCard clinicWaqfId={clinic.id} established={clinic.status === "established"} />

      <InvestmentsCard clinicWaqfId={clinic.id} established={clinic.status === "established"} />

      <PriceListCard clinicWaqfId={clinic.id} />

      <ClaimsCard clinic={clinic} onChange={load} />

      <Card className="mt-5">
        <p className="text-sm font-medium text-slate-700">Gifts</p>
        <p className="mb-3 text-xs text-slate-500">
          The latest 200. They settle into the clinic waqf&apos;s own Paystack subaccount; a confirmed gift is booked to its pot.
        </p>
        {gifts && gifts.length === 0 && <EmptyState title="No gifts yet" description="Gifts made on the giving page appear here." />}
        {gifts && gifts.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {gifts.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="text-slate-800">
                    {formatAmount(g.amount)} {g.currency} to the {g.pot === "endowment" ? `endowment (deed v${g.deed?.version ?? "?"})` : "running fund"}
                    {Number(g.feeCover) > 0 && <span className="text-slate-500"> + {formatAmount(g.feeCover)} fee cover</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(g.createdAt)} · {g.donor?.fullName || g.contactEmail || g.contactWhatsApp || "No contact given"}
                  </p>
                </div>
                <Badge tone={g.status === "confirmed" ? "success" : g.status === "failed" ? "danger" : "warning"}>{humanize(g.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5">
        <p className="text-sm font-medium text-slate-700">Ledger ({ledger.currency})</p>
        <p className="mb-4 text-xs text-slate-500">
          The two pots are kept apart: nothing moves from the endowment to the running fund. The endowment's income is earned
          straight into the running fund.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <PotTable title="Endowment (kept for ever)" rows={ledger.endowment} />
          <PotTable title="Running fund (spent)" rows={ledger.running} />
        </div>
      </Card>
    </div>
  );
}

function PotTable({ title, rows }: { title: string; rows: ClinicLedgerRow[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {rows.map((r) => (
          <li key={r.code} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="text-slate-700">
              <span className="mr-2 text-xs text-slate-400">{r.code}</span>
              {r.name}
            </span>
            <span className="tabular-nums text-slate-900">{formatAmount(r.balance)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
