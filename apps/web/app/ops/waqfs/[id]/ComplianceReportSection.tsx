"use client";

// Compliance Report — assembled fresh on every "Generate report" click
// (ComplianceReportsService.generate(), GET /compliance-reports/:waqfId),
// not a persisted document. Not auto-loaded on mount: every generate()
// call writes its own audit_logs entry ("compliance_report.exported" —
// pulling this report is itself a compliance-relevant event), so this
// only fires on explicit staff action, never silently on page visit.
//
// "Export" here is the browser's own print-to-PDF, not a generated
// file — the smallest thing that gets a Founder or regulator a real PDF
// without a new export pipeline (CLAUDE.md's "start simple" posture).
import { useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate, humanize, humanizePermissionKey } from "../../../../lib/format";
import type { ComplianceReport, ComplianceReportAuditLog } from "../../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  DetailGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";

const LICENSE_TONE: Record<ComplianceReport["trusteeLicenseStatus"], "success" | "neutral" | "warning" | "danger"> = {
  active: "success",
  pending: "neutral",
  suspended: "warning",
  expired: "danger",
  unlicensed: "danger",
};

const GOVERNED_ACTION_STATUS_TONE: Record<
  ComplianceReport["governedActions"][number]["status"],
  "success" | "neutral" | "danger"
> = {
  approved: "success",
  proposed: "neutral",
  rejected: "danger",
};

function describeActor(log: ComplianceReportAuditLog): string {
  if (log.actorUser) return log.actorUser.fullName;
  if (log.actorAgent) return `${log.actorAgent.name} (AI agent)`;
  if (log.actorFounder) return log.actorFounder.name;
  return humanize(log.actorType);
}

export function ComplianceReportSection({ waqfId }: { waqfId: string }) {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetchJson<ComplianceReport>(`/compliance-reports/${waqfId}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Compliance Report</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Governed-action history, audit trail, and license status for this waqf, assembled fresh on request.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {report && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
          )}
          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={loading} onClick={generate}>
            {loading ? "Generating…" : report ? "Regenerate" : "Generate report"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't generate report" className="mb-4">
          {error}
        </Alert>
      )}

      {report && (
        <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-5">
          <DetailGrid
            columns={3}
            items={[
              { label: "Jurisdiction", value: report.waqf.jurisdiction },
              {
                label: "Trustee license",
                value: (
                  <Badge tone={LICENSE_TONE[report.trusteeLicenseStatus]}>
                    {humanize(report.trusteeLicenseStatus)}
                  </Badge>
                ),
              },
              { label: "Generated", value: formatDate(report.generatedAt) },
            ]}
            className="border-b border-slate-100 pb-5"
          />

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Compliance framework</p>
            {report.policySet ? (
              <div className="text-sm text-slate-700">
                <p className="font-medium text-slate-900">{report.policySet.frameworkName}</p>
                {report.policySet.referenceUrl && (
                  <a
                    href={report.policySet.referenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-700 underline"
                  >
                    {report.policySet.referenceUrl}
                  </a>
                )}
                {report.policySet.notes && <p className="mt-1 text-slate-500">{report.policySet.notes}</p>}
              </div>
            ) : (
              <p className="text-sm italic text-slate-400">
                No compliance framework configured for &ldquo;{report.waqf.jurisdiction}&rdquo; yet — see
                Jurisdictions.
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Governed actions ({report.governedActions.length})
            </p>
            {report.governedActions.length === 0 ? (
              <p className="text-sm text-slate-400">None on record for this waqf.</p>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Permission</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Maker</TableHeaderCell>
                    <TableHeaderCell>Checker</TableHeaderCell>
                    <TableHeaderCell>Proposed</TableHeaderCell>
                    <TableHeaderCell>Decided</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.governedActions.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium text-slate-900">
                        {humanizePermissionKey(a.permission.key)}
                      </TableCell>
                      <TableCell>
                        <Badge tone={GOVERNED_ACTION_STATUS_TONE[a.status]}>{humanize(a.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {a.makerAgent ? `${a.makerAgent.name} (AI)` : (a.makerUser?.fullName ?? "—")}
                      </TableCell>
                      <TableCell className="text-slate-500">{a.checkerUser?.fullName ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-slate-500">{formatDate(a.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-slate-500">
                        {a.decidedAt ? formatDate(a.decidedAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Audit trail ({report.auditLogs.length})
            </p>
            {report.auditLogs.length === 0 ? (
              <p className="text-sm text-slate-400">No audit log entries for this waqf yet.</p>
            ) : (
              <ul className="max-h-96 space-y-2 overflow-y-auto text-sm print:max-h-none print:overflow-visible">
                {report.auditLogs.map((log) => (
                  <li
                    key={log.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-slate-50 pb-2"
                  >
                    <span>
                      <span className="font-medium text-slate-800">{humanizePermissionKey(log.action)}</span>{" "}
                      <span className="text-slate-400">·</span> {describeActor(log)}
                    </span>
                    <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(log.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
