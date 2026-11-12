"use client";

// The zakah AML review list: patterns for a person to judge, never an
// automatic block (CLAUDE.md's 2026-09-15 note chose manual review for
// the different-emails gap). Includes giving that spans Vault and zakah,
// which neither product's own threshold check adds together. Holding a
// flagged payment is the existing, separate Hold action.
import { useCallback, useEffect, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { formatDate, formatMoney } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staff-session";
import type { ZakahPaymentRow, ZakahReviewPayment, ZakahReviewVaultGift, ZakahStructuringReview } from "../../../lib/ops-types";
import { Alert, Badge, EmptyState, IconShieldAlert, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@birr/ui";
import { RowsSkeleton, SectionHeader } from "../_components/SectionChrome";
import { PaymentHoldActions } from "../zakah/PaymentHoldActions";

const POOL_LABEL = { mal: "Zakah on wealth", fitr_food: "Zakah al-Fitr (food)", fitr_cash: "Zakah al-Fitr (cash)" } as const;

function payerLabel(p: ZakahReviewPayment): string {
  return p.payerFullName ?? p.payerEmail ?? "Anonymous";
}

/** The Hold action wants a payment row; a flagged payment is always confirmed. */
function asPaymentRow(p: ZakahReviewPayment): ZakahPaymentRow {
  return {
    id: p.id, amount: p.amount, feeCover: "0", currency: "NGN", status: "confirmed", rulesetKey: null, rulesetVersion: null,
    createdAt: p.createdAt, confirmedAt: null, payer: null, heldAt: p.heldAt,
  };
}

export default function ZakahReviewPage() {
  const { staff, can } = useStaffSession();
  const [review, setReview] = useState<ZakahStructuringReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetchJson<ZakahStructuringReview>("/zakah-payments/structuring-review")
      .then(setReview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);
  useEffect(load, [load]);

  if (staff && !can("zakah.structuring_review")) {
    // The backend refuses anyone else; say so rather than show its error.
    return (
      <Alert tone="danger" title="Not available to your role">
        The zakah giving review is for Compliance, the Audit Committee, the Board of Trustees and Mutawalli Officers.
      </Alert>
    );
  }

  const paymentsTable = (payments: ZakahReviewPayment[]) => (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Payer</TableHeaderCell>
          <TableHeaderCell>Zakah</TableHeaderCell>
          <TableHeaderCell>Date</TableHeaderCell>
          <TableHeaderCell />
        </TableRow>
      </TableHead>
      <TableBody>
        {payments.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <div className="font-medium text-slate-900">{payerLabel(p)}</div>
              <div className="text-xs text-slate-500">
                {p.payerFullName && p.payerEmail ? `${p.payerEmail} · ` : ""}
                {p.payerIdCaptured ? "ID on file" : "no ID on file"}
              </div>
            </TableCell>
            <TableCell className="tabular-nums">
              {formatMoney(p.amount, "NGN")}
              <div className="text-xs text-slate-500">{POOL_LABEL[p.pool]}</div>
            </TableCell>
            <TableCell className="text-sm text-slate-500">{formatDate(p.createdAt)}</TableCell>
            <TableCell>{p.heldAt ? <Badge tone="danger">on AML hold</Badge> : <PaymentHoldActions payment={asPaymentRow(p)} onChange={load} />}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const vaultTable = (gifts: ZakahReviewVaultGift[]) => (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Vault donor</TableHeaderCell>
          <TableHeaderCell>Gift</TableHeaderCell>
          <TableHeaderCell>Date</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {gifts.map((g) => (
          <TableRow key={g.id}>
            <TableCell>
              <div className="font-medium text-slate-900">{g.donorFullName ?? g.donorEmail}</div>
              <div className="text-xs text-slate-500">{g.donorIdCaptured ? "ID on file" : "no ID on file"}</div>
            </TableCell>
            <TableCell className="tabular-nums">
              {formatMoney(g.amount, "NGN")}
              <div className="text-xs text-slate-500">{g.vaultName}</div>
            </TableCell>
            <TableCell className="text-sm text-slate-500">{formatDate(g.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div>
      <header className="mb-8 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-accent-300 shadow-sm">
          <IconShieldAlert className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Zakah giving review</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Patterns worth a closer look — never proof on their own. A shared network can be a household or an office. Holding a
            payment is a separate, deliberate step.
          </p>
        </div>
      </header>

      {error && (
        <Alert tone="danger" title="Couldn't load the review list" className="mb-6">
          {error}
        </Alert>
      )}
      {!error && review === null && <RowsSkeleton columns={4} />}

      {review && (
        <>
          <section className="mb-10">
            <SectionHeader
              title="Close to the threshold"
              description={
                review.thresholdAmount
                  ? `Different payers each paying at least half the ${formatMoney(review.thresholdAmount, "NGN")} ID threshold into the same pool.`
                  : "No NGN ID threshold is set, so there's nothing to compare against."
              }
            />
            {review.nearThreshold.length === 0 ? (
              <EmptyState title="Nothing flagged" description="No pool has several payers paying close to the threshold." />
            ) : (
              review.nearThreshold.map((g) => (
                <div key={g.pool} className="mb-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">
                    {POOL_LABEL[g.pool]} · {g.distinctPayerCount} different payers
                  </p>
                  {paymentsTable(g.payments)}
                </div>
              ))
            )}
          </section>

          <section className="mb-10">
            <SectionHeader title="Shared networks" description="Different payer identities paying from the same network (IP address)." />
            {review.ipClusters.length === 0 ? (
              <EmptyState title="Nothing flagged" description="No network is shared by different zakah payers." />
            ) : (
              review.ipClusters.map((c) => (
                <div key={c.ipAddress} className="mb-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">
                    <span className="font-mono">{c.ipAddress}</span> · {c.distinctPayerCount} different payers
                  </p>
                  {paymentsTable(c.payments)}
                </div>
              ))
            )}
          </section>

          <section className="mb-10">
            <SectionHeader
              title="Giving across Vault and zakah"
              description="Each product's ID check counts only its own giving. These are NGN totals that together reach the threshold, or a network both products' givers used under different emails."
            />
            {review.acrossVault.sameEmail.length === 0 && review.acrossVault.sharedNetworks.length === 0 && (
              <EmptyState title="Nothing flagged" description="No one's combined Vault and zakah giving reaches the threshold, and no network is shared across the two." />
            )}
            {review.acrossVault.sameEmail.map((m) => (
              <div key={m.email} className="mb-6">
                <p className="mb-2 text-sm font-medium text-slate-700">
                  {m.email} · zakah {formatMoney(m.zakahTotal, "NGN")} + Vault {formatMoney(m.vaultTotal, "NGN")} ={" "}
                  <span className="text-slate-900">{formatMoney(m.combinedTotal, "NGN")}</span>
                </p>
                {paymentsTable(m.zakah)}
                <div className="mt-2">{vaultTable(m.vault)}</div>
              </div>
            ))}
            {review.acrossVault.sharedNetworks.map((n) => (
              <div key={n.ipAddress} className="mb-6">
                <p className="mb-2 text-sm font-medium text-slate-700">
                  <span className="font-mono">{n.ipAddress}</span> · {n.distinctEmailCount} different emails across Vault and zakah
                </p>
                {paymentsTable(n.zakah)}
                <div className="mt-2">{vaultTable(n.vault)}</div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
