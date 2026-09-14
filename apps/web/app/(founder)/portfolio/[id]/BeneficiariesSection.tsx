"use client";

// Founder-facing, read-only, and deliberately an aggregate — never
// individual beneficiary rows. A beneficiary's name and eligibility
// criteria are real personal information about who receives a payout,
// and standard endowment practice keeps that confidential from the
// donor, not just from the general public. See
// BeneficiariesService.summaryForFounder's own comment.
import { useEffect, useRef, useState } from "react";
import { apiFetchJson } from "../../../../lib/api";
import type { Bank, BeneficiarySummary, WaqfCause } from "../../../../lib/types";
import { Alert, Button, Combobox, Input, Skeleton, StatCard } from "@birr/ui";

interface BulkNominationResult {
  createdCount: number;
  errors: { rowIndex: number; name: string; message: string }[];
}

export function BeneficiariesSection({ waqfId }: { waqfId: string }) {
  const [summary, setSummary] = useState<BeneficiarySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nominateState, setNominateState] = useState<"idle" | "form" | "bulk" | "submitted">("idle");
  const [bulkResult, setBulkResult] = useState<BulkNominationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetchJson<BeneficiarySummary>(`/beneficiaries/summary?waqfId=${waqfId}`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [waqfId]);

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <div className="mb-1.5 flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Beneficiaries</p>
        {nominateState === "idle" && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setNominateState("form")}>
              Nominate a beneficiary
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setNominateState("bulk")}>
              Bulk import (CSV)
            </Button>
          </div>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-500">
        Who this fund serves, in aggregate — individual identities stay confidential, same as standard endowment
        practice.
      </p>

      {nominateState === "submitted" && (
        <Alert tone="success" title="Nomination submitted" className="mb-4">
          Birr staff will review this before your fund's beneficiary count updates.
        </Alert>
      )}

      {bulkResult && nominateState === "idle" && (
        <Alert
          tone={bulkResult.errors.length === 0 ? "success" : "warning"}
          title={`${bulkResult.createdCount} nomination(s) submitted for review`}
          className="mb-4"
        >
          {bulkResult.errors.length > 0 && (
            <div className="mt-1.5 space-y-0.5 text-xs">
              <p>{bulkResult.errors.length} row(s) were skipped:</p>
              {bulkResult.errors.map((e) => (
                <p key={e.rowIndex}>
                  Row {e.rowIndex + 1} ({e.name || "unnamed"}): {e.message}
                </p>
              ))}
            </div>
          )}
        </Alert>
      )}

      {nominateState === "form" && (
        <NominateBeneficiaryFormPanel
          waqfId={waqfId}
          onSubmitted={() => setNominateState("submitted")}
          onCancel={() => setNominateState("idle")}
        />
      )}

      {nominateState === "bulk" && (
        <BulkNominateCsvPanel
          waqfId={waqfId}
          onSubmitted={(result) => {
            setBulkResult(result);
            setNominateState("idle");
          }}
          onCancel={() => setNominateState("idle")}
        />
      )}

      {error && (
        <Alert tone="danger" title="Couldn't load beneficiary summary">
          {error}
        </Alert>
      )}

      {!error && summary === null && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!error && summary !== null && summary.total === 0 && (
        <p className="text-sm text-slate-500">No beneficiaries registered yet.</p>
      )}

      {!error && summary !== null && summary.total > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Total beneficiaries" value={summary.total} tone="primary" />
            <StatCard label="Active" value={summary.byStatus.active} tone="success" />
            <StatCard label="Inactive" value={summary.byStatus.inactive} tone="neutral" />
          </div>
          {summary.byCause.length > 0 && (
            <div className="space-y-1.5">
              {summary.byCause.map((c) => (
                <div
                  key={c.causeId}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="text-slate-700">{c.causeName}</span>
                  <span className="font-medium text-slate-900">
                    {c.count} {c.count === 1 ? "beneficiary" : "beneficiaries"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Founder-Portal self-service — proposing someone for this waqf's
 * beneficiary list. NOT immediate registration (see
 * BeneficiaryNominationsService.propose's own comment on why beneficiary
 * identity stays independently verified by Birr, unlike Cause
 * Allocation's self-service posture) — it lands in a review queue on
 * the Ops side. Deliberately minimal, same "propose-and-confirm, no
 * status list here" convention as CausesSection.tsx's
 * SuggestCauseFormPanel: the review queue itself lives entirely on the
 * Ops side, matching CLAUDE.md's "Founder-facing surfaces stay
 * lightweight" instruction.
 */
function NominateBeneficiaryFormPanel({
  waqfId,
  onSubmitted,
  onCancel,
}: {
  waqfId: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"individual" | "organization">("individual");
  const [eligibilityCriteria, setEligibilityCriteria] = useState("");
  const [causeId, setCauseId] = useState("");
  const [causes, setCauses] = useState<WaqfCause[]>([]);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [payoutProvider, setPayoutProvider] = useState<"paystack" | "stripe" | "stablecoin">("paystack");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState(false);

  useEffect(() => {
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`)
      .then(setCauses)
      .catch(() => setCauses([]));
  }, [waqfId]);

  // Loaded on demand, once, the first time the bank picker actually
  // becomes visible — not on every mount, since most nominations never
  // touch this section at all.
  useEffect(() => {
    if (!showBankDetails || banks.length > 0 || banksLoading) return;
    setBanksLoading(true);
    apiFetchJson<Bank[]>("/banks")
      .then(setBanks)
      .catch(() => setBanksError(true))
      .finally(() => setBanksLoading(false));
  }, [showBankDetails, banks.length, banksLoading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !eligibilityCriteria.trim() || !causeId) {
      setError("Name, cause, and eligibility are all required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetchJson("/beneficiary-nominations", {
        method: "POST",
        body: JSON.stringify({
          waqfId,
          name: name.trim(),
          kind,
          eligibilityCriteria: eligibilityCriteria.trim(),
          causeId,
          phone: phone || undefined,
          email: email || undefined,
          payoutProvider: showBankDetails ? payoutProvider : undefined,
          bankDetails:
            showBankDetails && bankName && accountNumber && accountName
              ? { bankName, accountNumber, accountName, bankCode: bankCode || undefined }
              : undefined,
        }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't submit nomination">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Name</label>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "individual" | "organization")}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="individual">Individual</option>
            <option value="organization">Organization (e.g. orphanage, mosque)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Cause</label>
          <select
            required
            value={causeId}
            onChange={(e) => setCauseId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">Select a cause…</option>
            {causes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[16rem] flex-[2] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Why they're eligible</label>
          <Input
            required
            placeholder='e.g. "Widowed, no income, 3 dependents"'
            value={eligibilityCriteria}
            onChange={(e) => setEligibilityCriteria(e.target.value)}
            maxLength={1000}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Phone (optional)</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="min-w-[12rem] space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Email (optional)</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      {!showBankDetails ? (
        <button
          type="button"
          className="text-xs font-medium text-primary-700 hover:underline"
          onClick={() => setShowBankDetails(true)}
        >
          + Include bank details
        </button>
      ) : (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs text-slate-500">
            Shared securely with Birr for verification — you won't see this again after submitting.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Payout provider</label>
              <select
                value={payoutProvider}
                onChange={(e) => setPayoutProvider(e.target.value as "paystack" | "stripe" | "stablecoin")}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="paystack">Paystack</option>
                <option value="stripe" disabled>
                  Stripe (coming soon)
                </option>
                <option value="stablecoin" disabled>
                  Stablecoin (coming soon)
                </option>
              </select>
            </div>
            <div className="min-w-[14rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Bank</label>
              {payoutProvider === "paystack" ? (
                <>
                  <Combobox
                    options={banks.map((bank) => ({ value: bank.code, label: bank.name }))}
                    value={bankCode}
                    onChange={(code) => {
                      setBankCode(code);
                      setBankName(banks.find((bank) => bank.code === code)?.name ?? "");
                    }}
                    loading={banksLoading}
                    placeholder="Search for a bank…"
                  />
                  {banksError && <p className="mt-1 text-xs text-red-600">Couldn&apos;t load the bank list — try again shortly.</p>}
                </>
              ) : (
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
              )}
            </div>
            <div className="min-w-[10rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Account number</label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </div>
            <div className="min-w-[10rem] space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Account name</label>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </div>
            <button
              type="button"
              className="text-xs text-slate-500 hover:underline"
              onClick={() => {
                setShowBankDetails(false);
                setBankName("");
                setAccountNumber("");
                setAccountName("");
                setBankCode("");
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

const CSV_TEMPLATE = "Name,Kind,Cause,Eligibility,Phone,Email\nAhmad Bello,individual,Education,\"Orphaned, under 18\",,\n";

// Minimal RFC-4180-ish parser — handles quoted fields (so a comma or a
// literal quote can appear inside "Eligibility", the one column likely
// to contain either) and CRLF/LF line endings. Not a full CSV grammar
// (no multi-line quoted fields), which is a deliberate "start simple"
// cut for what's realistically a spreadsheet export, not arbitrary CSV.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      // skip — the following \n (if any) drives the row break
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

interface ParsedRow {
  name: string;
  kind: "individual" | "organization";
  causeName: string;
  causeId: string | null;
  eligibilityCriteria: string;
  phone: string;
  email: string;
  clientError: string | null;
}

function downloadCsvTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "beneficiary-nominations-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * CSV import for a founder onboarding an existing beneficiary roster
 * (an NGO's existing list, say) rather than re-typing it one at a time
 * through NominateBeneficiaryFormPanel above. Deliberately no bank
 * details column — see ProposeBulkBeneficiaryNominationsInput's own
 * comment on why that's a separate, later step. Cause is matched by
 * name (case-insensitive) against this waqf's own causes, not by id —
 * a spreadsheet author knows the cause's name, not its database id.
 */
function BulkNominateCsvPanel({
  waqfId,
  onSubmitted,
  onCancel,
}: {
  waqfId: string;
  onSubmitted: (result: BulkNominationResult) => void;
  onCancel: () => void;
}) {
  const [causes, setCauses] = useState<WaqfCause[]>([]);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetchJson<WaqfCause[]>(`/waqf-causes?waqfId=${waqfId}`)
      .then(setCauses)
      .catch(() => setCauses([]));
  }, [waqfId]);

  function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const table = parseCsv(text);
      if (table.length < 2) {
        setError("That file has no data rows — check it has a header row plus at least one beneficiary.");
        setRows(null);
        return;
      }
      const header = table[0].map((h) => h.trim().toLowerCase());
      const col = (name: string) => header.indexOf(name);
      const nameCol = col("name");
      const causeCol = col("cause");
      const eligibilityCol = col("eligibility");
      if (nameCol === -1 || causeCol === -1 || eligibilityCol === -1) {
        setError('The header row must include "Name", "Cause", and "Eligibility" columns.');
        setRows(null);
        return;
      }
      const kindCol = col("kind");
      const phoneCol = col("phone");
      const emailCol = col("email");

      const parsed: ParsedRow[] = table.slice(1).map((cells) => {
        const name = (cells[nameCol] ?? "").trim();
        const causeName = (cells[causeCol] ?? "").trim();
        const eligibilityCriteria = (cells[eligibilityCol] ?? "").trim();
        const kindRaw = (kindCol >= 0 ? cells[kindCol] : "")?.trim().toLowerCase();
        const kind: "individual" | "organization" = kindRaw === "organization" ? "organization" : "individual";
        const cause = causes.find((c) => c.name.toLowerCase() === causeName.toLowerCase());

        let clientError: string | null = null;
        if (!name) clientError = "Missing name.";
        else if (!eligibilityCriteria) clientError = "Missing eligibility.";
        else if (!causeName) clientError = "Missing cause.";
        else if (!cause) clientError = `Cause "${causeName}" doesn't match any of this fund's causes.`;

        return {
          name,
          kind,
          causeName,
          causeId: cause?.id ?? null,
          eligibilityCriteria,
          phone: (phoneCol >= 0 ? cells[phoneCol] : "")?.trim() ?? "",
          email: (emailCol >= 0 ? cells[emailCol] : "")?.trim() ?? "",
          clientError,
        };
      });
      setRows(parsed);
    };
    reader.readAsText(file);
  }

  const validRows = rows?.filter((r) => !r.clientError) ?? [];
  const invalidCount = (rows?.length ?? 0) - validRows.length;

  async function handleSubmit() {
    if (validRows.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetchJson<BulkNominationResult>("/beneficiary-nominations/bulk", {
        method: "POST",
        body: JSON.stringify({
          waqfId,
          rows: validRows.map((r) => ({
            name: r.name,
            kind: r.kind,
            causeId: r.causeId,
            eligibilityCriteria: r.eligibilityCriteria,
            phone: r.phone || undefined,
            email: r.email || undefined,
          })),
        }),
      });
      onSubmitted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      {error && (
        <Alert tone="danger" title="Couldn't import">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">Import a beneficiary roster</p>
          <p className="mt-0.5 text-xs text-slate-500">
            A CSV with Name, Cause, Eligibility columns (Kind/Phone/Email optional). Cause names must match one of
            this fund's own causes.
          </p>
        </div>
        <button type="button" className="shrink-0 text-xs font-medium text-primary-700 hover:underline" onClick={downloadCsvTemplate}>
          Download template
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {rows && (
        <div>
          <p className="mb-2 text-xs text-slate-500">
            {fileName} — {rows.length} row(s) parsed, {validRows.length} ready to submit
            {invalidCount > 0 ? `, ${invalidCount} with problems` : ""}.
          </p>
          <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">#</th>
                  <th className="px-2.5 py-1.5 font-medium">Name</th>
                  <th className="px-2.5 py-1.5 font-medium">Cause</th>
                  <th className="px-2.5 py-1.5 font-medium">Eligibility</th>
                  <th className="px-2.5 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i} className={r.clientError ? "bg-red-50" : undefined}>
                    <td className="px-2.5 py-1.5 text-slate-400">{i + 1}</td>
                    <td className="px-2.5 py-1.5 text-slate-800">{r.name || "—"}</td>
                    <td className="px-2.5 py-1.5 text-slate-600">{r.causeName || "—"}</td>
                    <td className="max-w-[16rem] truncate px-2.5 py-1.5 text-slate-600">{r.eligibilityCriteria || "—"}</td>
                    <td className="px-2.5 py-1.5">
                      {r.clientError ? (
                        <span className="text-red-600">{r.clientError}</span>
                      ) : (
                        <span className="text-primary-700">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" disabled={submitting || validRows.length === 0} onClick={handleSubmit}>
          {submitting ? "Submitting…" : `Submit ${validRows.length || ""} nomination(s)`}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
