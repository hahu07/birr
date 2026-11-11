import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff, ZakahReviewPayment, ZakahStructuringReview } from "../../../lib/ops-types";
import ZakahReviewPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

function staffWith(roles: string[], permissions: string[]): BirrStaff {
  return {
    id: "staff-1", userId: "user-1", roles, permissions, status: "active",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    user: { id: "user-1", email: "staff@example.com", fullName: "Test Staff", status: "active", mfaEnabled: true, whatsappNumber: null, whatsappVerifiedAt: null },
  } as BirrStaff;
}

function payment(id: string, overrides: Partial<ZakahReviewPayment> = {}): ZakahReviewPayment {
  return {
    id, pool: "mal", amount: "9000000.00", createdAt: "2027-02-10T00:00:00.000Z", heldAt: null, payerId: `payer-${id}`,
    payerEmail: `${id}@example.com`, payerFullName: null, payerIdCaptured: false, ...overrides,
  };
}

const review: ZakahStructuringReview = {
  currency: "NGN",
  thresholdAmount: "15000000.00",
  nearThreshold: [{ pool: "mal", distinctPayerCount: 2, payments: [payment("p-1"), payment("p-2", { heldAt: "2027-02-11T00:00:00.000Z" })] }],
  ipClusters: [],
  acrossVault: {
    sameEmail: [
      {
        email: "amina@example.com", zakahTotal: "9000000.00", vaultTotal: "7000000.00", combinedTotal: "16000000.00",
        zakah: [payment("p-3", { payerEmail: "amina@example.com", payerFullName: "Amina Bello" })],
        vault: [{ id: "v-1", vaultName: "Ramadan Relief", amount: "7000000.00", createdAt: "2027-02-09T00:00:00.000Z", donorEmail: "amina@example.com", donorFullName: null, donorIdCaptured: false }],
      },
    ],
    sharedNetworks: [],
  },
};

function setup(staff: BirrStaff) {
  mockedApiFetchJson.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/birr-staff/me") return Promise.resolve(staff);
    if (path === "/zakah-payments/structuring-review") return Promise.resolve(review);
    if (path.endsWith("/hold") && init?.method === "POST") return Promise.resolve({});
    return Promise.reject(new Error(`Unhandled path in test: ${path}`));
  });
  render(
    <StaffSessionProvider>
      <ZakahReviewPage />
    </StaffSessionProvider>,
  );
  return userEvent.setup();
}

describe("Ops Console — Zakah giving review", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
  });

  test("shows each signal, combined Vault and zakah totals, and which payments are already held", async () => {
    setup(staffWith(["audit_committee"], ["zakah.structuring_review"]));
    expect(await screen.findByText(/Zakah on wealth · 2 different payers/)).toBeInTheDocument();
    expect(screen.getByText(/zakah ₦9,000,000.00 \+ Vault ₦7,000,000.00 =/)).toBeInTheDocument();
    expect(screen.getByText("₦16,000,000.00")).toBeInTheDocument();
    expect(screen.getByText("Ramadan Relief")).toBeInTheDocument();
    expect(screen.getByText("on AML hold")).toBeInTheDocument();
    // The Audit Committee can see the list but not place holds.
    expect(screen.queryByRole("button", { name: "Hold" })).not.toBeInTheDocument();
  });

  test("someone who may hold can act on a flagged payment straight from the list", async () => {
    const user = setup(staffWith(["compliance_officer"], ["zakah.structuring_review", "zakah.payment_hold"]));
    const holds = await screen.findAllByRole("button", { name: "Hold" });
    // p-1 and p-3; p-2 is already held.
    expect(holds).toHaveLength(2);
    await user.click(holds[0]);
    await user.type(screen.getByLabelText("Why"), "Two payers near the threshold within an hour.");
    await user.click(screen.getByRole("button", { name: "Hold payment" }));
    await waitFor(() =>
      expect(mockedApiFetchJson.mock.calls.some(([p, i]) => p === "/zakah-payments/p-1/hold" && i?.method === "POST")).toBe(true),
    );
  });

  test("tells someone without the permission that it isn't available to their role", async () => {
    setup(staffWith(["platform_admin"], []));
    expect(await screen.findByText("Not available to your role")).toBeInTheDocument();
  });
});
