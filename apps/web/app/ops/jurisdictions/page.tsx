"use client";

// Jurisdictions — Birr's own trustee-licensing standing plus the
// compliance policy set registry, both keyed by the same free-form
// jurisdiction string as Waqf.jurisdiction (see schema.prisma's comments
// on TrusteeLicense/CompliancePolicySet). Writes are platform_admin-only
// (backend-enforced; this page also hides the forms for other roles as
// a UX nicety, same posture as the Platform Settings page). Neither
// section blocks anything — see TrusteeLicense's own comment for why
// establishment isn't gated on license status.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, humanize } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { CompliancePolicySet, TrusteeLicense, TrusteeLicenseStatus } from "../../../lib/ops-types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconGlobe,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";

const LICENSE_STATUSES: TrusteeLicenseStatus[] = ["active", "pending", "suspended", "expired"];
const LICENSE_TONE: Record<TrusteeLicenseStatus, "success" | "neutral" | "warning" | "danger"> = {
  active: "success",
  pending: "neutral",
  suspended: "warning",
  expired: "danger",
};

export default function JurisdictionsPage() {
  const { staff } = useStaffSession();
  const isAdmin = staff?.staffRole === "platform_admin";

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconGlobe className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Jurisdictions</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Where Birr is actually licensed as trustee, and which compliance framework applies where.
          </p>
        </div>
      </header>

      {!isAdmin && staff && (
        <Alert tone="danger" title="platform_admin only to edit" className="mb-6">
          Your role ({humanize(staff.staffRole)}) can view this page but not change it — reach out to a platform
          admin.
        </Alert>
      )}

      <div className="space-y-10">
        <TrusteeLicensesSection isAdmin={isAdmin} />
        <CompliancePolicySetsSection isAdmin={isAdmin} />
      </div>
    </div>
  );
}

function TrusteeLicensesSection({ isAdmin }: { isAdmin: boolean }) {
  const [licenses, setLicenses] = useState<TrusteeLicense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<TrusteeLicense[]>("/trustee-licenses")
      .then(setLicenses)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <SectionHeader
        title="Trustee Licenses"
        description="CLAUDE.md's regulatory posture, made concrete: acting as trustee is itself a regulated activity in most jurisdictions."
        actionLabel={isAdmin ? (showForm ? "Cancel" : "Add license") : undefined}
        onAction={isAdmin ? () => setShowForm((v) => !v) : undefined}
      />

      {isAdmin && showForm && (
        <TrusteeLicenseForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load trustee licenses" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && licenses === null && <RowsSkeleton columns={4} />}

      {!error && licenses !== null && licenses.length === 0 && (
        <EmptyState
          title="No trustee licenses recorded yet"
          description="Every jurisdiction Birr operates a waqf in should have a license status here."
        />
      )}

      {!error && licenses !== null && licenses.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Jurisdiction</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Licensing authority</TableHeaderCell>
              <TableHeaderCell>Expires</TableHeaderCell>
              <TableHeaderCell>Notes</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {licenses.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium text-slate-900">{l.jurisdiction}</TableCell>
                <TableCell>
                  <Badge tone={LICENSE_TONE[l.status]}>{humanize(l.status)}</Badge>
                </TableCell>
                <TableCell className="text-slate-500">{l.licensingAuthority}</TableCell>
                <TableCell className="text-slate-500">{l.expiresAt ? formatDate(l.expiresAt) : "—"}</TableCell>
                <TableCell className="max-w-xs truncate text-slate-500" title={l.notes ?? undefined}>
                  {l.notes ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function TrusteeLicenseForm({ onCreated }: { onCreated: () => void }) {
  const [jurisdiction, setJurisdiction] = useState("");
  const [status, setStatus] = useState<TrusteeLicenseStatus>("pending");
  const [licensingAuthority, setLicensingAuthority] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/trustee-licenses", {
        method: "POST",
        body: JSON.stringify({
          jurisdiction,
          status,
          licensingAuthority,
          licenseNumber: licenseNumber || undefined,
          expiresAt: expiresAt || undefined,
          notes: notes || undefined,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't add license">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Jurisdiction</label>
          <Input required autoFocus placeholder="NG" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TrusteeLicenseStatus)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {LICENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Licensing authority</label>
          <Input required value={licensingAuthority} onChange={(e) => setLicensingAuthority(e.target.value)} />
        </div>
        <div className="w-40 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">License number (optional)</label>
          <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
        </div>
        <div className="w-40 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Expires (optional)</label>
          <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Notes (optional)</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}

function CompliancePolicySetsSection({ isAdmin }: { isAdmin: boolean }) {
  const [policySets, setPolicySets] = useState<CompliancePolicySet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<CompliancePolicySet[]>("/compliance-policy-sets")
      .then(setPolicySets)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <SectionHeader
        title="Compliance Policy Sets"
        description="Which named framework applies per jurisdiction (AAOIFI/IFSB/local regulator) — a pointer to where the real rules live, not the rules themselves. Populated by Legal/Compliance, not invented here."
        actionLabel={isAdmin ? (showForm ? "Cancel" : "Add policy set") : undefined}
        onAction={isAdmin ? () => setShowForm((v) => !v) : undefined}
      />

      {isAdmin && showForm && (
        <CompliancePolicySetForm
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load compliance policy sets" className="mb-4">
          {error}
        </Alert>
      )}

      {!error && policySets === null && <RowsSkeleton columns={3} />}

      {!error && policySets !== null && policySets.length === 0 && (
        <EmptyState
          title="No compliance policy sets configured yet"
          description="Compliance reports will note this explicitly until one is added per jurisdiction."
        />
      )}

      {!error && policySets !== null && policySets.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Jurisdiction</TableHeaderCell>
              <TableHeaderCell>Framework</TableHeaderCell>
              <TableHeaderCell>Reference</TableHeaderCell>
              <TableHeaderCell>Notes</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {policySets.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-slate-900">{p.jurisdiction}</TableCell>
                <TableCell className="text-slate-500">{p.frameworkName}</TableCell>
                <TableCell className="text-slate-500">
                  {p.referenceUrl ? (
                    <a
                      href={p.referenceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-700 hover:text-primary-800"
                    >
                      Link
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="max-w-xs truncate text-slate-500" title={p.notes ?? undefined}>
                  {p.notes ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function CompliancePolicySetForm({ onSaved }: { onSaved: () => void }) {
  const [jurisdiction, setJurisdiction] = useState("");
  const [frameworkName, setFrameworkName] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson(`/compliance-policy-sets/${encodeURIComponent(jurisdiction)}`, {
        method: "PUT",
        body: JSON.stringify({
          frameworkName,
          referenceUrl: referenceUrl || undefined,
          notes: notes || undefined,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't save policy set">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Jurisdiction</label>
          <Input required autoFocus placeholder="NG" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Framework name</label>
          <Input
            required
            placeholder="e.g. AAOIFI + UAE Central Bank waqf regulations"
            value={frameworkName}
            onChange={(e) => setFrameworkName(e.target.value)}
          />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Reference URL (optional)</label>
          <Input value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Notes (optional)</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
