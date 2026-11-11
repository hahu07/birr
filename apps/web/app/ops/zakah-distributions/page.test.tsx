import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff, ZakahDistributionRow, ZakahDistributionSummary, ZakahRecipientRow } from "../../../lib/ops-types";
import ZakahDistributionsPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

function staffWith(roles: string[], permissions: string[]): BirrStaff {
  return {
    id: "staff-1",
    userId: "user-1",
    roles,
    permissions,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    user: { id: "user-1", email: "staff@example.com", fullName: "Test Staff", status: "active", mfaEnabled: true, whatsappNumber: null, whatsappVerifiedAt: null },
  } as BirrStaff;
}

const officer = staffWith(["mutawalli_officer"], [
  "zakah.recipient_manage",
  "zakah.distribution_create",
  "zakah.distribution_approve",
  "zakah.distribution_mark_paid",
]);

const summary: ZakahDistributionSummary = {
  currency: "NGN",
  received: "500000.00",
  committed: "120000.00",
  paid: "50000.00",
  refunded: "0.00",
  available: "380000.00",
  oldestUndistributedSince: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  byCategory: [{ category: "gharimin", status: "paid", amount: "50000" }],
};

const musa: ZakahRecipientRow = {
  id: "rec-1",
  name: "Musa Ibrahim",
  categories: ["fuqara", "gharimin"],
  eligibilityReason: "Lost his job; verified by home visit.",
  phone: null,
  active: true,
  bank: { bankName: "Test Bank", accountLast4: "6789" },
  createdAt: "2027-02-01T00:00:00.000Z",
};

function distribution(overrides: Partial<ZakahDistributionRow>): ZakahDistributionRow {
  return {
    id: "d-1",
    recipient: { id: "rec-1", name: "Musa Ibrahim" },
    counterparty: null,
    category: "fuqara",
    amount: "20000.00",
    currency: "NGN",
    reason: "Food for the month.",
    status: "pending_approval",
    approvedAt: null,
    paidOn: null,
    bankReference: null,
    partnerReachedCount: null,
    partnerReport: null,
    partnerReportedAt: null,
    createdAt: "2027-02-10T00:00:00.000Z",
    ...overrides,
  };
}

function setup(staff: BirrStaff, distributions: ZakahDistributionRow[] = []) {
  mockedApiFetchJson.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/birr-staff/me") return Promise.resolve(staff);
    if (path === "/zakah-distributions/summary") return Promise.resolve(summary);
    if (path === "/zakah-distributions" && !init?.method) return Promise.resolve(distributions);
    if (path === "/zakah-distributions/recipients" && !init?.method) return Promise.resolve([musa]);
    if (path === "/zakah-distributions" && init?.method === "POST") return Promise.resolve({ id: "d-new" });
    if (path === "/governed-actions" || path === "/zakah-distributions/recipients") return Promise.resolve({});
    return Promise.reject(new Error(`Unhandled path in test: ${path}`));
  });
  render(
    <StaffSessionProvider>
      <ZakahDistributionsPage />
    </StaffSessionProvider>,
  );
  return userEvent.setup();
}

function bodiesSentTo(path: string) {
  return mockedApiFetchJson.mock.calls.filter(([p, init]) => p === path && init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string));
}

// Typing-heavy, so allow more than the 5s default on a busy machine.
describe("Ops Console — Zakah distributions", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
  });

  test("shows what's available, how long the oldest zakah has waited, and what's been paid by category", async () => {
    setup(staffWith(["audit_committee"], []));
    expect(await screen.findByText("₦380,000.00")).toBeInTheDocument();
    expect(screen.getByText("12 days")).toBeInTheDocument();
    expect(screen.getByText(/those in debt \(al-gharimin\) ₦50,000.00/)).toBeInTheDocument();
  });

  test("shows no controls to someone without the permissions", async () => {
    setup(staffWith(["audit_committee"], []), [distribution({})]);
    expect(await screen.findByText("Food for the month.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New distribution" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Register a recipient" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose for approval" })).not.toBeInTheDocument();
  });

  test("creating a distribution offers only the recipient's own categories, then sends it for approval", async () => {
    const user = setup(officer);
    await user.click(await screen.findByRole("button", { name: "New distribution" }));
    await user.selectOptions(screen.getByLabelText("Recipient"), "rec-1");

    const options = [...(screen.getByLabelText("Category") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(["", "fuqara", "gharimin"]);

    await user.selectOptions(screen.getByLabelText("Category"), "gharimin");
    await user.type(screen.getByLabelText("Amount (₦)"), "25,000");
    await user.type(screen.getByLabelText("Why this payment fits this category"), "Clearing a debt for his children's school fees.");
    await user.click(screen.getByRole("button", { name: "Create and send for approval" }));

    await waitFor(() => expect(bodiesSentTo("/governed-actions")).toHaveLength(1));
    expect(bodiesSentTo("/zakah-distributions")).toEqual([
      { recipientId: "rec-1", category: "gharimin", amount: "25000", reason: "Clearing a debt for his children's school fees." },
    ]);
    expect(bodiesSentTo("/governed-actions")[0]).toEqual({ permissionKey: "zakah.distribution_approve", payload: { distributionId: "d-new" } });
  });

  test("an approved distribution's payment goes to a second person to confirm", async () => {
    const user = setup(officer, [distribution({ status: "approved", approvedAt: "2027-02-11T00:00:00.000Z" })]);
    await user.click(await screen.findByRole("button", { name: "Record payment" }));
    await user.type(screen.getByLabelText("Bank reference"), "NIP-000123");
    await user.click(screen.getByRole("button", { name: "Send for confirmation" }));

    await waitFor(() => expect(bodiesSentTo("/governed-actions")).toHaveLength(1));
    expect(bodiesSentTo("/governed-actions")[0]).toMatchObject({
      permissionKey: "zakah.distribution_mark_paid",
      payload: { distributionId: "d-1", bankReference: "NIP-000123", paidOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
  });

  test("registering a recipient never offers the closed administrators' category", async () => {
    const user = setup(officer);
    await user.click(await screen.findByRole("button", { name: "Register a recipient" }));
    expect(screen.queryByLabelText(/zakah administrators/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Full name"), "Hauwa Sani");
    await user.click(screen.getByLabelText("the needy (al-masakin)"));
    await user.type(screen.getByLabelText("Why they qualify"), "Widow with four children; no regular income.");
    await user.click(screen.getByRole("button", { name: "Register recipient" }));

    await waitFor(() => expect(bodiesSentTo("/zakah-distributions/recipients")).toHaveLength(1));
    expect(bodiesSentTo("/zakah-distributions/recipients")[0]).toMatchObject({
      name: "Hauwa Sani",
      categories: ["masakin"],
      eligibilityReason: "Widow with four children; no regular income.",
    });
  });
});
