import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff } from "../../../lib/ops-types";
import PaymentReconciliationPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../lib/api";

const mockedFetch = vi.mocked(apiFetchJson);
let currentStaff: BirrStaff;

function staffWith(permissions: string[]): BirrStaff {
  return {
    id: "s1",
    userId: "u1",
    roles: ["compliance_officer"],
    permissions,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    user: { id: "u1", email: "c@birr.dev", fullName: "Compliance", status: "active", mfaEnabled: true, whatsappNumber: null, whatsappVerifiedAt: null },
  } as BirrStaff;
}

const issue = {
  id: "i1",
  direction: "in",
  kind: "in_status_mismatch",
  providerReference: "ref-1",
  product: "vault_contribution",
  recordId: "gift-1",
  paystackStatus: "success",
  paystackAmount: "250000",
  birrStatus: "pending",
  birrAmount: "250000",
  currency: "NGN",
  detail: "Vault gift paid at Paystack, but Birr shows it pending.",
  status: "open",
  resolvedAt: null,
  resolutionNote: null,
  resolvedBy: null,
  run: { day: "2026-11-15" },
};

function renderAs(staff: BirrStaff) {
  currentStaff = staff;
  render(
    <StaffSessionProvider>
      <PaymentReconciliationPage />
    </StaffSessionProvider>,
  );
}

describe("Ops: Payment Reconciliation", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/birr-staff/me") return currentStaff;
      if (path === "/payment-reconciliation/runs") {
        return [{ id: "r1", day: "2026-11-15", status: "issues", error: null, trigger: "scheduler", counts: { in: { paystack: 4, birr: 5 }, out: { paystack: 0, birr: 0 }, refunds: { paystack: 0, birr: 0 }, mismatches: 1 }, startedAt: "2026-11-16T01:00:00Z", finishedAt: "2026-11-16T01:00:05Z", startedBy: null }];
      }
      if (path.startsWith("/payment-reconciliation/issues?")) return [issue];
      if (path === "/payment-reconciliation/issues/i1/recheck") return { birrStatusBefore: "pending", birrStatusNow: "confirmed" };
      if (path === "/payment-reconciliation/issues/i1/resolve") return { ...issue, status: "resolved" };
      throw new Error(path);
    });
  });

  test("shows runs and open mismatches with both sides", async () => {
    renderAs(staffWith(["payments.reconciliation_view"]));
    expect(await screen.findByText("Vault gift paid at Paystack, but Birr shows it pending.")).toBeInTheDocument();
    expect(screen.getByText("1 mismatch")).toBeInTheDocument();
    expect(screen.getByText("4 · 5")).toBeInTheDocument();
    // View-only roles can't act.
    expect(screen.queryByRole("button", { name: "Ask Paystack again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run now" })).not.toBeInTheDocument();
  });

  test("Compliance asks Paystack again, then resolves with a note", async () => {
    const user = userEvent.setup();
    renderAs(staffWith(["payments.reconciliation_view", "payments.reconciliation_resolve", "payments.reconciliation_run"]));
    await user.click(await screen.findByRole("button", { name: "Ask Paystack again" }));
    expect(await screen.findByText("Paystack checked: now confirmed at Birr (was pending).")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark resolved…" }));
    const resolve = screen.getByRole("button", { name: "Resolve" });
    expect(resolve).toBeDisabled();
    await user.type(screen.getByLabelText("What was found, and what was done"), "Late webhook; now confirmed.");
    await user.click(resolve);
    await waitFor(() => expect(mockedFetch.mock.calls.some(([p]) => p === "/payment-reconciliation/issues/i1/resolve")).toBe(true));
    const [, init] = mockedFetch.mock.calls.find(([p]) => p === "/payment-reconciliation/issues/i1/resolve")!;
    expect(JSON.parse(init!.body as string)).toEqual({ note: "Late webhook; now confirmed." });
    expect(screen.getByRole("button", { name: "Run now" })).toBeInTheDocument();
  });
});
