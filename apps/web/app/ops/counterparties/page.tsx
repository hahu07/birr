"use client";

// The registry of external institutions actually holding waqf investment
// money — banks, asset managers, broker-dealers. Registration is plain
// CRUD (investment_committee-only, they source these relationships
// day-to-day) and starts at `pending_review`: nothing here can receive
// investment until it clears two independent gates — see the detail page
// (Shariah sign-off + a counterparty.onboard governed-action approval).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetchJson } from "../../../lib/api";
import { formatAmount, humanize } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { Counterparty } from "../../../lib/ops-types";
import { Alert, Badge, Button, EmptyState, IconLandmark, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";

const INSTITUTION_TYPES: Counterparty["institutionType"][] = [
  "bank",
  "asset_manager",
  "broker_dealer",
  "fund_administrator",
  "business",
  "other",
];

const STATUS_TONE: Record<Counterparty["status"], "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  pending_review: "neutral",
  under_review: "warning",
  suspended: "warning",
  blacklisted: "danger",
};

export default function CounterpartiesPage() {
  const { staff } = useStaffSession();
  const canRegister = staff?.staffRole === "investment_committee";

  const [counterparties, setCounterparties] = useState<Counterparty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    apiFetchJson<Counterparty[]>("/counterparties")
      .then(setCounterparties)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-900/25">
          <IconLandmark className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Counterparties</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            External institutions actually holding waqf investment money — exposure is tracked per counterparty
            across every waqf combined.
          </p>
        </div>
      </header>

      {!canRegister && staff && (
        <Alert tone="danger" title="investment_committee only to register" className="mb-6">
          Your role ({humanize(staff.staffRole)}) can view this registry but not add to it.
        </Alert>
      )}

      <section>
        <SectionHeader
          title="Registry"
          description="pending_review until both a Shariah sign-off and an onboarding approval clear — see each entry's own page."
          actionLabel={canRegister ? (showForm ? "Cancel" : "Register counterparty") : undefined}
          onAction={canRegister ? () => setShowForm((v) => !v) : undefined}
        />

        {showForm && canRegister && (
          <RegisterForm
            onRegistered={() => {
              setShowForm(false);
              load();
            }}
          />
        )}

        {error && (
          <Alert tone="danger" title="Couldn't load counterparties" className="mb-4">
            {error}
          </Alert>
        )}

        {!error && counterparties === null && <RowsSkeleton columns={5} />}

        {!error && counterparties !== null && counterparties.length === 0 && !showForm && (
          <EmptyState title="No counterparties registered yet" description="Register one above before placing any investment." />
        )}

        {!error && counterparties !== null && counterparties.length > 0 && (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Jurisdiction</TableHeaderCell>
                <TableHeaderCell>Held (every waqf combined)</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {counterparties.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-slate-900">
                    <Link href={`/ops/counterparties/${c.id}`} className="hover:text-primary-700">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>{humanize(c.institutionType)}</TableCell>
                  <TableCell className="text-slate-500">{c.jurisdiction}</TableCell>
                  <TableCell className="text-slate-500">
                    {formatAmount(c.totalInvested ?? "0")}
                    {c.concentrationLimit && <> of {formatAmount(c.concentrationLimit)} limit</>}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[c.status]}>{humanize(c.status)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function RegisterForm({ onRegistered }: { onRegistered: () => void }) {
  const [name, setName] = useState("");
  const [institutionType, setInstitutionType] = useState<Counterparty["institutionType"]>("bank");
  const [jurisdiction, setJurisdiction] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [address, setAddress] = useState("");
  const [businessActivities, setBusinessActivities] = useState("");
  const [existingShariahCertification, setExistingShariahCertification] = useState("");
  const [website, setWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [regulatoryLicenseNumber, setRegulatoryLicenseNumber] = useState("");
  const [regulatingAuthority, setRegulatingAuthority] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetchJson("/counterparties", {
        method: "POST",
        body: JSON.stringify({
          name,
          institutionType,
          jurisdiction,
          registrationNumber: registrationNumber || undefined,
          address: address || undefined,
          businessActivities,
          existingShariahCertification: existingShariahCertification || undefined,
          website: website || undefined,
          contactName: contactName || undefined,
          contactEmail: contactEmail || undefined,
          contactPhone: contactPhone || undefined,
          regulatoryLicenseNumber: regulatoryLicenseNumber || undefined,
          regulatingAuthority: regulatingAuthority || undefined,
        }),
      });
      onRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't register counterparty">
          {error}
        </Alert>
      )}

      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Identity</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Type</label>
          <select
            value={institutionType}
            onChange={(e) => setInstitutionType(e.target.value as Counterparty["institutionType"])}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {INSTITUTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Jurisdiction</label>
          <Input required value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="AE" />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Registration number (optional)</label>
          <Input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} placeholder="Company registration no." />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Address (optional)</label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Website (optional)</label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </div>
      </div>

      {/* Required, not optional — this and existingShariahCertification
          below are what a shariah_board_member actually has to go on
          before recordShariahApproval. A one-line optional field here
          used to leave that review with nothing substantive to read
          (found 2026-09-04) — this is the fix, not a checklist added on
          top of a still-empty intake. */}
      <p className="pt-1 text-xs font-medium uppercase tracking-wide text-slate-500">Shariah review information</p>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Business activities</label>
        <textarea
          required
          minLength={20}
          rows={3}
          value={businessActivities}
          onChange={(e) => setBusinessActivities(e.target.value)}
          placeholder="What this counterparty actually does, including its primary revenue sources — e.g. whether it earns interest, deals in a prohibited sector, or is otherwise Shariah-relevant. The Shariah Board reviews this before signing off."
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Existing Shariah certification (optional)</label>
        <Input
          value={existingShariahCertification}
          onChange={(e) => setExistingShariahCertification(e.target.value)}
          placeholder="Name/reference of any Shariah board or certification this counterparty already holds, if any"
        />
      </div>

      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Point of contact (optional)</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Contact name</label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Contact email</label>
          <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Contact phone</label>
          <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </div>
      </div>

      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Regulatory (optional)</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Regulatory license number</label>
          <Input value={regulatoryLicenseNumber} onChange={(e) => setRegulatoryLicenseNumber(e.target.value)} />
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Regulating authority</label>
          <Input value={regulatingAuthority} onChange={(e) => setRegulatingAuthority(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Registering…" : "Register"}
        </Button>
      </div>
    </form>
  );
}
