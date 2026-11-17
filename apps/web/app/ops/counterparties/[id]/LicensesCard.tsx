"use client";

// A counterparty's licences (2026-11-17, clinic slice 1). One person records
// what the certificate says; a different person verifies it against the
// certificate or the regulator's register (the server and the database both
// refuse the same person). A healthcare provider is paid only while every
// required licence is verified and in date. Withdrawing one is Compliance
// alone, at once.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import { formatDate } from "../../../../lib/format";
import { useStaffSession } from "../../../../lib/staff-session";
import type { CounterpartyLicense, CounterpartyLicenses, LicenseRequirement } from "../../../../lib/ops-types";
import { Alert, Badge, Button, Card, EmptyState, Input, Select } from "@birr/ui";
import { COUNTERPARTY_LICENSE_KIND_LABELS, COUNTERPARTY_LICENSE_KINDS, FIELD_LIMITS, type CounterpartyLicenseKindKey } from "@birr/shared";

const REQUIREMENT_BADGE: Record<LicenseRequirement["status"], { tone: "success" | "warning" | "neutral" | "danger"; text: (r: LicenseRequirement) => string }> = {
  current: { tone: "success", text: (r) => `In date until ${formatDate(r.expiresOn!)}` },
  expired: { tone: "danger", text: (r) => `Expired ${formatDate(r.expiresOn!)}` },
  awaiting_verification: { tone: "warning", text: () => "Awaiting verification" },
  missing: { tone: "neutral", text: () => "None recorded" },
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());

function licenseState(license: CounterpartyLicense): { tone: "success" | "warning" | "neutral" | "danger"; text: string } {
  if (license.withdrawnAt) return { tone: "neutral", text: "Withdrawn" };
  if (!license.verifiedAt) return { tone: "warning", text: "Awaiting verification" };
  if (license.expiresOn.slice(0, 10) < today()) return { tone: "danger", text: "Expired" };
  return { tone: "success", text: "Verified" };
}

export function LicensesCard({ counterpartyId }: { counterpartyId: string }) {
  const { can, staff } = useStaffSession();
  const [data, setData] = useState<CounterpartyLicenses | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<CounterpartyLicenses>(`/counterparties/${counterpartyId}/licenses`)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [counterpartyId]);

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

  const canRecord = can("counterparty.license_record");
  const canVerify = can("counterparty.license_verify");
  const canWithdraw = can("counterparty.license_withdraw");

  return (
    <Card className="mt-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">Licences</p>
          <p className="text-xs text-slate-500">
            One person records a licence and someone else verifies it. Only verified licences in date count.
          </p>
        </div>
        {canRecord && (
          <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Record a licence"}
          </Button>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Couldn't load licences">
          {error}
        </Alert>
      )}
      {actionError && (
        <Alert tone="danger" title="Couldn't complete that action" className="mb-3">
          {actionError}
        </Alert>
      )}

      {showForm && canRecord && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <RecordLicenseForm
            disabled={busy}
            onSubmit={(input) =>
              run(() => apiFetchJson(`/counterparties/${counterpartyId}/licenses`, { method: "POST", body: JSON.stringify(input) })).then(
                (ok) => ok && setShowForm(false),
              )
            }
          />
        </div>
      )}

      {data && data.requirements.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Needed before payment</p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {data.requirements.map((r) => {
              const badge = REQUIREMENT_BADGE[r.status];
              return (
                <li key={r.kind} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm text-slate-700">{COUNTERPARTY_LICENSE_KIND_LABELS[r.kind]}</span>
                  <Badge tone={badge.tone}>{badge.text(r)}</Badge>
                </li>
              );
            })}
          </ul>
          {data.requirements.some((r) => r.status !== "current") && (
            <p className="mt-2 text-xs text-slate-500">Payments to this counterparty are refused until every one of these is in date.</p>
          )}
        </div>
      )}

      {data && data.licenses.length === 0 && (
        <EmptyState title="No licences recorded" description="Record each licence from its certificate; a colleague then verifies it." />
      )}

      {data && data.licenses.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {data.licenses.map((license) => {
            const state = licenseState(license);
            const isRecorder = staff?.userId === license.recordedByUserId;
            return (
              <li key={license.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{COUNTERPARTY_LICENSE_KIND_LABELS[license.kind]}</p>
                    <p className="text-xs text-slate-500">
                      {license.licenseNumber} · {license.issuingAuthority}
                      {license.issuedOn ? ` · issued ${formatDate(license.issuedOn)}` : ""} · expires {formatDate(license.expiresOn)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Recorded by {license.recordedByUser.fullName} on {formatDate(license.recordedAt)}
                      {license.verifiedByUser && license.verifiedAt
                        ? `; verified by ${license.verifiedByUser.fullName} on ${formatDate(license.verifiedAt)}: ${license.verificationNote}`
                        : ""}
                    </p>
                    {license.withdrawnByUser && license.withdrawnAt && (
                      <p className="mt-1 text-xs text-slate-500">
                        Withdrawn by {license.withdrawnByUser.fullName} on {formatDate(license.withdrawnAt)}: {license.withdrawalReason}
                      </p>
                    )}
                  </div>
                  <Badge tone={state.tone}>{state.text}</Badge>
                </div>
                {!license.withdrawnAt && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!license.verifiedAt && canVerify && !isRecorder && (
                      <ReasonButton
                        label="Verify"
                        field="How you checked it"
                        placeholder="e.g. Saw the original; confirmed on the MLSCN register"
                        disabled={busy}
                        onSubmit={(note) =>
                          run(() =>
                            apiFetchJson(`/counterparties/${counterpartyId}/licenses/${license.id}/verify`, {
                              method: "POST",
                              body: JSON.stringify({ note }),
                            }),
                          )
                        }
                      />
                    )}
                    {!license.verifiedAt && canVerify && isRecorder && (
                      <p className="text-xs text-slate-500">You recorded this licence, so a colleague must verify it.</p>
                    )}
                    {canWithdraw && (
                      <ReasonButton
                        label="Withdraw"
                        field="Why"
                        placeholder="e.g. Recorded in error, or suspended by the regulator"
                        variant="danger"
                        disabled={busy}
                        onSubmit={(reason) =>
                          run(() =>
                            apiFetchJson(`/counterparties/${counterpartyId}/licenses/${license.id}/withdraw`, {
                              method: "POST",
                              body: JSON.stringify({ reason }),
                            }),
                          )
                        }
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

interface RecordLicenseInput {
  kind: CounterpartyLicenseKindKey;
  licenseNumber: string;
  issuingAuthority: string;
  issuedOn?: string;
  expiresOn: string;
}

function RecordLicenseForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (input: RecordLicenseInput) => void }) {
  const [kind, setKind] = useState<CounterpartyLicenseKindKey>("health_facility_registration");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ kind, licenseNumber, issuingAuthority, issuedOn: issuedOn || undefined, expiresOn });
      }}
    >
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">Licence</label>
        <Select value={kind} onChange={(e) => setKind(e.target.value as CounterpartyLicenseKindKey)}>
          {COUNTERPARTY_LICENSE_KINDS.map((k) => (
            <option key={k} value={k}>
              {COUNTERPARTY_LICENSE_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Licence or policy number</label>
          <Input required check="reference" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Issued by</label>
          <Input
            required
            check="name"
            value={issuingAuthority}
            onChange={(e) => setIssuingAuthority(e.target.value)}
            placeholder="e.g. Oyo State Ministry of Health"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-44 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Issued on (optional)</label>
          <Input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </div>
        <div className="w-44 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Valid until</label>
          <Input required type="date" min={today()} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled}>
          Record licence
        </Button>
      </div>
    </form>
  );
}

function ReasonButton({
  label,
  field,
  placeholder,
  variant = "secondary",
  disabled,
  onSubmit,
}: {
  label: string;
  field: string;
  placeholder: string;
  variant?: "secondary" | "danger";
  disabled: boolean;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (!open) {
    return (
      <Button variant={variant} className="px-3 py-1.5 text-xs" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="min-w-[16rem] flex-1 space-y-1">
        <label className="text-xs font-medium text-slate-700">{field}</label>
        <Input value={text} maxLength={FIELD_LIMITS.longText} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
      </div>
      <Button
        variant={variant}
        className="px-3 py-1.5 text-xs"
        disabled={disabled || !text.trim()}
        onClick={() =>
          onSubmit(text.trim()).then((ok) => {
            if (ok) {
              setOpen(false);
              setText("");
            }
          })
        }
      >
        Confirm {label.toLowerCase()}
      </Button>
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
