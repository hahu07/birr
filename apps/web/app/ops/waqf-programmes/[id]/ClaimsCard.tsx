"use client";

// A clinic waqf's operator and monthly claims (2026-11-17, clinic slice 7).
// The Board assigns the licensed operator. Each month a Mutawalli Officer
// uploads the operator's anonymous claim lines, which the server checks
// against the approved price list, the bands and the monthly cap. The
// running fund part is approved by the Board or Compliance, paid by bank
// transfer and confirmed by a second person; the zakah part is paid through
// a zakah distribution to the operator, then linked here.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../../lib/api";
import { formatAmount, formatDate, humanize } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { ClinicClaim, ClinicClaimLine, WaqfProgramme, Counterparty, GovernedAction } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, Input, Select } from "@birr/ui";

const TONE: Record<ClinicClaim["status"], "success" | "warning" | "neutral" | "danger"> = {
  submitted: "warning",
  approved: "success",
  paid: "success",
  rejected: "danger",
  discarded: "neutral",
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const COLUMNS = "visit reference, visit date, service code, band code, patient paid, poor or needy (yes/no)";

/** Parses pasted CSV lines; a header line is skipped. Returns the lines or the first problem. */
function parseLines(text: string) {
  const rows = text
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => !/^visit/i.test(r));
  const lines = [];
  for (const [i, row] of rows.entries()) {
    const cells = row.split(",").map((c) => c.trim());
    if (cells.length !== 6) return { error: `Row ${i + 1} has ${cells.length} columns, not 6 (${COLUMNS}).` };
    const [visitReference, visitDate, serviceCode, bandCode, patientPaid, poor] = cells;
    if (!/^(yes|no|y|n|true|false)$/i.test(poor)) return { error: `Row ${i + 1}: the last column must be yes or no.` };
    lines.push({ visitReference, visitDate, serviceCode, bandCode, patientPaid: patientPaid.replace(/[₦\s]/g, ""), zakahEligible: /^(yes|y|true)$/i.test(poor) });
  }
  return lines.length ? { lines } : { error: "Paste at least one claim line." };
}

export function ClaimsCard({ clinic, onChange }: { clinic: WaqfProgramme; onChange: () => void }) {
  const { can } = useStaffSession();
  const [claims, setClaims] = useState<ClinicClaim[] | null>(null);
  const [providers, setProviders] = useState<Counterparty[]>([]);
  const [pending, setPending] = useState<GovernedAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiFetchJson<ClinicClaim[]>(`/waqf-programmes/${clinic.id}/claims`),
      apiFetchJson<Counterparty[]>("/counterparties?status=active"),
      apiFetchJson<GovernedAction[]>("/governed-actions?status=proposed"),
    ])
      .then(([c, p, a]) => {
        setClaims(c);
        setProviders(p.filter((x) => x.institutionType === "healthcare_provider"));
        setPending(a.filter((x) => x.permission.key.startsWith("clinic_waqf.")));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [clinic.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      load();
      onChange();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const propose = (permissionKey: string, payload: object) =>
    run(() => apiFetchJson("/governed-actions", { method: "POST", body: JSON.stringify({ permissionKey, payload }) }));
  const waiting = (key: string, field: string, value: string) =>
    pending.find((a) => a.permission.key === key && (a.payload as Record<string, unknown>)?.[field] === value);
  const canManage = can("waqf_programme.manage");
  const operatorProposal = waiting("clinic.operator_assign", "programmeId", clinic.id);

  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Operator and monthly claims</p>
          <p className="text-xs text-slate-500">
            Anonymous claim lines, checked against the approved price list. Poor or needy patients&apos; subsidies are paid from zakah; the rest
            from the running fund.
          </p>
        </div>
        {canManage && clinic.operator && clinic.status === "established" && !uploading && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setUploading(true)}>
            Upload a claim
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {error}
        </Alert>
      )}

      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="text-slate-700">
          Operator: <span className="font-medium text-slate-900">{clinic.operator?.name ?? "none assigned"}</span>
        </p>
        {operatorProposal ? (
          <p className="mt-1 text-xs text-slate-500">
            A new operator is waiting for the Board in the{" "}
            <Link href="/ops/governed-actions" className="font-medium text-primary-700 hover:text-primary-800">
              Approvals queue
            </Link>
            .
          </p>
        ) : (
          can("clinic.operator_assign") && (
            <AssignOperator providers={providers.filter((p) => p.id !== clinic.operator?.id)} disabled={busy} onSubmit={(counterpartyId) => propose("clinic.operator_assign", { programmeId: clinic.id, counterpartyId })} />
          )
        )}
      </div>

      {uploading && (
        <UploadForm
          disabled={busy}
          onCancel={() => setUploading(false)}
          onSubmit={(body) =>
            run(() => apiFetchJson(`/waqf-programmes/${clinic.id}/claims`, { method: "POST", body: JSON.stringify(body) })).then((ok) => ok && setUploading(false))
          }
          onError={setError}
        />
      )}

      {claims && claims.length === 0 && !uploading && <p className="text-sm text-slate-500">No claims yet.</p>}
      {claims && claims.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {claims.map((claim) => (
            <ClaimRow
              key={claim.id}
              programmeId={clinic.id}
              claim={claim}
              disabled={busy}
              approval={waiting("clinic.claim_approve", "claimId", claim.id)}
              payment={waiting("clinic.claim_mark_paid", "claimId", claim.id)}
              run={run}
              propose={propose}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AssignOperator({ providers, disabled, onSubmit }: { providers: Counterparty[]; disabled: boolean; onSubmit: (id: string) => void }) {
  const [id, setId] = useState("");
  if (providers.length === 0) return <p className="mt-1 text-xs text-slate-500">Onboard a healthcare provider, with its licences verified, to assign one.</p>;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Select value={id} onChange={(e) => setId(e.target.value)} className="min-w-[14rem]">
        <option value="">Choose a licensed healthcare provider…</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button className="px-3 py-1.5 text-xs" disabled={disabled || !id} onClick={() => onSubmit(id)}>
        Propose to the Board
      </Button>
    </div>
  );
}

function UploadForm({
  disabled,
  onCancel,
  onSubmit,
  onError,
}: {
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (body: { period: string; lines: unknown[] }) => void;
  onError: (message: string) => void;
}) {
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [text, setText] = useState("");
  return (
    <form
      className="mb-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = parseLines(text);
        if ("error" in parsed) return onError(parsed.error!);
        onSubmit({ period, lines: parsed.lines });
      }}
    >
      <div className="w-44 space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">Month of the visits</label>
        <Input required type="month" max={today().slice(0, 7)} value={period} onChange={(e) => setPeriod(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">Claim lines, one per row</label>
        <p className="text-xs text-slate-500">Columns: {COLUMNS}. No names or diagnoses.</p>
        <textarea
          rows={8}
          required
          maxLength={500_000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`IB-0412, ${today()}, ANC, B, 3700, no`}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={disabled}>
          Check and upload
        </Button>
      </div>
    </form>
  );
}

function ClaimRow({
  programmeId,
  claim,
  disabled,
  approval,
  payment,
  run,
  propose,
}: {
  programmeId: string;
  claim: ClinicClaim;
  disabled: boolean;
  approval?: GovernedAction;
  payment?: GovernedAction;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  propose: (key: string, payload: object) => Promise<boolean>;
}) {
  const { can } = useStaffSession();
  const [lines, setLines] = useState<ClinicClaimLine[] | null>(null);
  const [paying, setPaying] = useState(false);
  const [bankReference, setBankReference] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [zakahId, setZakahId] = useState("");
  const running = Number(claim.runningFundAmount) > 0;
  const zakah = Number(claim.zakahAmount) > 0;

  return (
    <li className="py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-800">
            {monthName(claim.period)} <span className="font-normal text-slate-500">· {claim.operator.name} · price list v{claim.priceList.version}</span>
          </p>
          <p className="text-xs text-slate-500">
            {claim.lineCount} services, ₦{formatAmount(claim.totalPrice)}; patients paid ₦{formatAmount(claim.patientPaid)}. Running fund ₦
            {formatAmount(claim.runningFundAmount)}; zakah ₦{formatAmount(claim.zakahAmount)}.
          </p>
          {claim.paidOn && (
            <p className="text-xs text-slate-500">
              Running fund part paid {formatDate(claim.paidOn)}, bank reference {claim.bankReference}.
            </p>
          )}
          {claim.zakahDistribution && <p className="text-xs text-slate-500">Zakah part: distribution {humanize(claim.zakahDistribution.status)}.</p>}
        </div>
        <Badge tone={TONE[claim.status]}>{humanize(claim.status)}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          onClick={() => (lines ? setLines(null) : apiFetchJson<ClinicClaimLine[]>(`/waqf-programmes/${programmeId}/claims/${claim.id}/lines`).then(setLines))}
        >
          {lines ? "Hide lines" : "Show lines"}
        </Button>
        {claim.status === "submitted" &&
          (approval ? (
            <span className="text-xs text-slate-500">Waiting for the Board or Compliance.</span>
          ) : (
            <>
              {can("clinic.claim_approve") && (
                <Button className="px-3 py-1.5 text-xs" disabled={disabled} onClick={() => propose("clinic.claim_approve", { claimId: claim.id })}>
                  Propose for approval
                </Button>
              )}
              {can("waqf_programme.manage") && (
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  disabled={disabled}
                  onClick={() => run(() => apiFetchJson(`/waqf-programmes/${programmeId}/claims/${claim.id}/discard`, { method: "POST" }))}
                >
                  Discard
                </Button>
              )}
            </>
          ))}
        {claim.status === "approved" &&
          running &&
          (payment ? (
            <span className="text-xs text-slate-500">Payment waiting for confirmation.</span>
          ) : (
            can("clinic.claim_mark_paid") &&
            !paying && (
              <Button className="px-3 py-1.5 text-xs" onClick={() => setPaying(true)}>
                Record the running fund payment
              </Button>
            )
          ))}
      </div>

      {paying && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Bank reference</label>
            <Input check="reference" value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Paid on</label>
            <Input type="date" max={today()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <Button
            className="px-3 py-1.5 text-xs"
            disabled={disabled || bankReference.trim().length < 3}
            onClick={() => propose("clinic.claim_mark_paid", { claimId: claim.id, bankReference: bankReference.trim(), paidOn }).then((ok) => ok && setPaying(false))}
          >
            Send for confirmation
          </Button>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setPaying(false)}>
            Cancel
          </Button>
        </div>
      )}

      {(claim.status === "approved" || claim.status === "paid") && zakah && !claim.zakahDistribution && can("waqf_programme.manage") && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-600">
            Pay the zakah part as a{" "}
            <Link href="/ops/zakah" className="font-medium text-primary-700 hover:text-primary-800">
              zakah distribution
            </Link>{" "}
            to {claim.operator.name}: zakah on wealth, the poor or the needy, exactly ₦{formatAmount(claim.zakahAmount)}. Then link it here.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="min-w-[18rem]" placeholder="Zakah distribution id" value={zakahId} onChange={(e) => setZakahId(e.target.value)} />
            <Button
              className="px-3 py-1.5 text-xs"
              disabled={disabled || !zakahId.trim()}
              onClick={() =>
                run(() =>
                  apiFetchJson(`/waqf-programmes/${programmeId}/claims/${claim.id}/zakah-distribution`, {
                    method: "POST",
                    body: JSON.stringify({ zakahDistributionId: zakahId.trim() }),
                  }),
                )
              }
            >
              Link
            </Button>
          </div>
        </div>
      )}

      {lines && (
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 font-medium">Visit</th>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Service</th>
              <th className="py-1 font-medium">Band</th>
              <th className="py-1 text-right font-medium">Patient paid</th>
              <th className="py-1 text-right font-medium">Subsidy</th>
              <th className="py-1 font-medium">Paid from</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 text-slate-700">
                <td className="py-1 font-mono">{l.visitReference}</td>
                <td className="py-1">{l.visitDate.slice(0, 10)}</td>
                <td className="py-1 font-mono">{l.serviceCode}</td>
                <td className="py-1">{l.bandCode}</td>
                <td className="py-1 text-right tabular-nums">{formatAmount(l.patientPaid)}</td>
                <td className="py-1 text-right tabular-nums">{formatAmount(l.subsidy)}</td>
                <td className="py-1">{l.zakahEligible ? "Zakah" : "Running fund"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
