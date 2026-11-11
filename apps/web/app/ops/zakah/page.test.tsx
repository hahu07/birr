import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { draftRulesets } from "@birr/zakah";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff, ZakahLedgerBalance, ZakahMetalPriceRow, ZakahPaymentRow, ZakahRefundRow, ZakahRulesetRow } from "../../../lib/ops-types";
import ZakahPage from "./page";

vi.mock("../../../lib/api", () => ({
  apiFetch: vi.fn(),
  apiFetchJson: vi.fn(),
}));

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
    user: {
      id: "user-1",
      email: "staff@example.com",
      fullName: "Test Staff",
      status: "active",
      mfaEnabled: true,
      whatsappNumber: null,
      whatsappVerifiedAt: null,
    },
  } as BirrStaff;
}

const price: ZakahMetalPriceRow = {
  id: "price-1",
  goldPerGram: "150000",
  silverPerGram: "2000",
  asOf: "2001-01-10T00:00:00.000Z",
  source: "Fixture source",
  createdAt: "2001-01-10T00:00:00.000Z",
};

const draft: ZakahRulesetRow = {
  id: "ruleset-1",
  key: "maliki",
  madhhab: "maliki",
  version: 1,
  label: "Maliki",
  rulings: draftRulesets.maliki.rulings,
  status: "draft",
  approvedAt: null,
  createdAt: "2026-11-11T00:00:00.000Z",
};

const ledger: ZakahLedgerBalance[] = [
  { code: "1000", name: "Zakah bank account", type: "asset", debit: "95000.00", credit: "0.00", balance: "95000.00" },
  { code: "2000", name: "Zakah held for recipients", type: "liability", debit: "0.00", credit: "95000.00", balance: "95000.00" },
];

function setup(
  staff: BirrStaff,
  {
    prices = [price],
    rulesets = [draft],
    payments = [],
    refunds = [],
  }: { prices?: ZakahMetalPriceRow[]; rulesets?: ZakahRulesetRow[]; payments?: ZakahPaymentRow[]; refunds?: ZakahRefundRow[] } = {},
) {
  mockedApiFetchJson.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/birr-staff/me") return Promise.resolve(staff);
    if (path === "/zakah/metal-prices") return Promise.resolve(prices);
    if (path === "/zakah/rulesets") return Promise.resolve(rulesets);
    if (path === "/zakah-payments") return Promise.resolve(payments);
    if (path === "/zakah-refunds" && !init?.method) return Promise.resolve(refunds);
    if (path === "/zakah-refunds" && init?.method === "POST") return Promise.resolve({ id: "rf-new" });
    if (path === "/zakah-payments/ledger") return Promise.resolve(ledger);
    if (path === "/governed-actions" || path.startsWith("/zakah/rulesets")) return Promise.resolve({});
    return Promise.reject(new Error(`Unhandled path in test: ${path}`));
  });
  return render(
    <StaffSessionProvider>
      <ZakahPage />
    </StaffSessionProvider>,
  );
}

function postsTo(path: string) {
  return mockedApiFetchJson.mock.calls.filter(([p, init]) => p === path && init?.method);
}

// Typing-heavy, so allow more than the 5s default on a busy machine.
describe("Ops Console — Zakah", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
  });

  test("shows prices and rulesets with their status, and no controls without permission", async () => {
    setup(staffWith(["audit_committee"], []));

    expect(await screen.findByText("Fixture source")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByText(/Personal jewellery exempt · debts deducted · nisab by gold \(85g gold \/ 595g silver\)/)).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Propose new prices" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft a ruleset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose for Shariah approval" })).not.toBeInTheDocument();
  });

  test("lists payments with the payer, or Anonymous, and the zakah held for recipients", async () => {
    setup(staffWith(["compliance_officer"], []), {
      payments: [
        { id: "p-1", amount: "95000.00", feeCover: "1548.23", currency: "NGN", status: "confirmed", rulesetKey: "maliki", rulesetVersion: 1, createdAt: "2027-02-10T00:00:00.000Z", confirmedAt: "2027-02-10T00:01:00.000Z", payer: { email: "amina@example.com", fullName: "Amina Bello" } },
        { id: "p-2", amount: "5000.00", feeCover: "0.00", currency: "NGN", status: "pending", rulesetKey: null, rulesetVersion: null, createdAt: "2027-02-11T00:00:00.000Z", confirmedAt: null, payer: null },
      ],
    });

    expect(await screen.findByText("Amina Bello")).toBeInTheDocument();
    expect(screen.getByText("amina@example.com")).toBeInTheDocument();
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.getByText(/\+ ₦1,548.23 fee cover/)).toBeInTheDocument();
    expect(screen.getByText("Held for recipients, not yet distributed:")).toBeInTheDocument();
  });

  test("Compliance requests a refund on a confirmed payment and sends it to the Board", async () => {
    const user = userEvent.setup();
    setup(staffWith(["compliance_officer"], ["zakah.refund_request", "zakah.refund_approve"]), {
      payments: [
        { id: "p-1", amount: "95000.00", feeCover: "0.00", currency: "NGN", status: "confirmed", rulesetKey: null, rulesetVersion: null, createdAt: "2027-02-10T00:00:00.000Z", confirmedAt: "2027-02-10T00:01:00.000Z", payer: { email: "amina@example.com", fullName: "Amina Bello" } },
        { id: "p-2", amount: "5000.00", feeCover: "0.00", currency: "NGN", status: "pending", rulesetKey: null, rulesetVersion: null, createdAt: "2027-02-11T00:00:00.000Z", confirmedAt: null, payer: null },
      ],
    });

    // Only the confirmed payment can be refunded.
    expect(await screen.findAllByRole("button", { name: "Refund" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Refund" }));
    expect(screen.getByLabelText("Zakah to refund (₦)")).toHaveValue("95000.00");
    await user.type(screen.getByLabelText("What happened"), "Amina paid the same zakah twice in one minute.");
    await user.type(screen.getByLabelText("Bank"), "Test Bank");
    await user.type(screen.getByLabelText("Account number"), "0123456789");
    await user.type(screen.getByLabelText("Account name"), "Amina Bello");
    await user.click(screen.getByRole("button", { name: "Send to the Board" }));

    await waitFor(() => expect(postsTo("/governed-actions")).toHaveLength(1));
    expect(JSON.parse(postsTo("/zakah-refunds")[0][1]!.body as string)).toEqual({
      paymentId: "p-1",
      amount: "95000.00",
      reason: "duplicate_payment",
      details: "Amina paid the same zakah twice in one minute.",
      bankName: "Test Bank",
      accountNumber: "0123456789",
      accountName: "Amina Bello",
    });
    expect(JSON.parse(postsTo("/governed-actions")[0][1]!.body as string)).toEqual({
      permissionKey: "zakah.refund_approve",
      payload: { refundId: "rf-new" },
    });
  });

  test("an officer records an approved refund's bank payment for a second person to confirm", async () => {
    const user = userEvent.setup();
    setup(staffWith(["mutawalli_officer"], ["zakah.refund_mark_paid"]), {
      refunds: [
        {
          id: "rf-1", amount: "95000", currency: "NGN", reason: "duplicate_payment", details: "Paid twice.", status: "approved",
          approvedAt: "2027-02-12T00:00:00.000Z", paidOn: null, bankReference: null, payeeBank: { bankName: "Test Bank", accountLast4: "6789" },
          createdAt: "2027-02-11T00:00:00.000Z", payment: { id: "p-1", amount: "95000", createdAt: "2027-02-10T00:00:00.000Z", payer: null },
        },
      ],
    });

    expect(await screen.findByText("approved — to pay")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refund" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record refund payment" }));
    await user.type(screen.getByLabelText("Bank reference"), "NIP-REF-77");
    await user.click(screen.getByRole("button", { name: "Send for confirmation" }));

    await waitFor(() => expect(postsTo("/governed-actions")).toHaveLength(1));
    expect(JSON.parse(postsTo("/governed-actions")[0][1]!.body as string)).toMatchObject({
      permissionKey: "zakah.refund_mark_paid",
      payload: { refundId: "rf-1", bankReference: "NIP-REF-77" },
    });
  });

  test("Investment Committee proposes new prices as a governed action", async () => {
    const user = userEvent.setup();
    setup(staffWith(["investment_committee"], ["zakah.metal_price_set"]));

    await user.click(await screen.findByRole("button", { name: "Propose new prices" }));
    await user.type(screen.getByLabelText("Gold, ₦ per gram"), "165000");
    await user.type(screen.getByLabelText("Silver, ₦ per gram"), "2100");
    await user.type(screen.getByLabelText("Source"), "LBMA via CBN rate");
    await user.click(screen.getByRole("button", { name: "Propose for approval" }));

    await waitFor(() => expect(postsTo("/governed-actions")).toHaveLength(1));
    const body = JSON.parse(postsTo("/governed-actions")[0][1]!.body as string);
    expect(body).toMatchObject({
      permissionKey: "zakah.metal_price_set",
      payload: { goldPerGram: "165000", silverPerGram: "2100", source: "LBMA via CBN rate" },
    });
    expect(body.payload.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("a Mutawalli Officer proposes a draft for Shariah approval with exactly what's shown", async () => {
    const user = userEvent.setup();
    setup(staffWith(["mutawalli_officer"], ["zakah.ruleset_draft", "zakah.ruleset_approve"]));

    await user.click(await screen.findByRole("button", { name: "Propose for Shariah approval" }));

    await waitFor(() => expect(postsTo("/governed-actions")).toHaveLength(1));
    expect(JSON.parse(postsTo("/governed-actions")[0][1]!.body as string)).toEqual({
      permissionKey: "zakah.ruleset_approve",
      payload: { rulesetId: "ruleset-1", label: "Maliki", rulings: draftRulesets.maliki.rulings },
    });
  });

  test("a new draft starts from the bundled position for the chosen madhhab", async () => {
    const user = userEvent.setup();
    setup(staffWith(["mutawalli_officer"], ["zakah.ruleset_draft"]), { rulesets: [] });

    await user.click(await screen.findByRole("button", { name: "Draft a ruleset" }));
    await user.selectOptions(screen.getByLabelText("Madhhab"), "hanafi");
    expect(screen.getByLabelText("Personal jewellery")).toHaveValue("zakatable");
    expect(screen.getByLabelText("Key")).toHaveValue("hanafi");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(postsTo("/zakah/rulesets")).toHaveLength(1));
    expect(JSON.parse(postsTo("/zakah/rulesets")[0][1]!.body as string)).toEqual({
      key: "hanafi",
      madhhab: "hanafi",
      label: "Hanafi",
      rulings: draftRulesets.hanafi.rulings,
    });
  });

  test("editing a draft sends only its label and rulings", async () => {
    const user = userEvent.setup();
    setup(staffWith(["mutawalli_officer"], ["zakah.ruleset_draft"]));

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const form = screen.getByRole("button", { name: "Save draft" }).closest("form")!;
    expect(within(form).getByLabelText("Madhhab")).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText("Nisab basis"), "silver");
    await user.click(within(form).getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(postsTo("/zakah/rulesets/ruleset-1")).toHaveLength(1));
    const [, init] = postsTo("/zakah/rulesets/ruleset-1")[0];
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(init!.body as string)).toEqual({
      label: "Maliki",
      rulings: { ...draftRulesets.maliki.rulings, nisabBasis: "silver" },
    });
  });
});
