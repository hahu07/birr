import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff } from "../../../lib/ops-types";
import MonthlyGivingPage from "./page";

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

const row = {
  id: "g1",
  kind: "vault",
  status: "active",
  pauseReason: null,
  email: "amina@example.com",
  amount: "250000",
  currency: "NGN",
  dayOfMonth: 15,
  nextPeriod: "2026-12",
  nextChargeAt: "2026-12-15T08:00:00.000Z",
  failedAttempts: 0,
  card: { last4: "4081", brand: "visa", expMonth: 12, expYear: 2030 },
  target: { name: "Ramadan Relief", detail: "Water Wells" },
  createdAt: "2026-11-15T10:00:00.000Z",
  cancelledAt: null,
  cancelledBy: null,
  endedReason: null,
};

let currentStaff: BirrStaff;

function renderAs(staff: BirrStaff) {
  currentStaff = staff;
  render(
    <StaffSessionProvider>
      <MonthlyGivingPage />
    </StaffSessionProvider>,
  );
}

describe("Ops: Monthly Giving", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
    mockedApiFetchJson.mockImplementation(async (path: string) => {
      if (path === "/birr-staff/me") return currentStaff;
      if (path === "/recurring-gifts") return [row];
      if (path === "/recurring-gifts/g1") return { ...row, charges: [], history: [{ action: "recurring_gift.activated", actorType: "system", createdAt: row.createdAt }] };
      if (path === "/recurring-gifts/g1/cancel") return { ...row, status: "cancelled", charges: [], history: [] };
      throw new Error(path);
    });
  });

  test("lists monthly gifts with the active monthly total", async () => {
    renderAs(staffWith(["audit_committee"], ["giving.monthly_view"]));
    expect(await screen.findByText("amina@example.com")).toBeInTheDocument();
    expect(screen.getByText(/1 active/)).toBeInTheDocument();
    expect(screen.getByText("Ramadan Relief")).toBeInTheDocument();
  });

  test("only Compliance can stop a gift, and only with a reason", async () => {
    const user = userEvent.setup();
    renderAs(staffWith(["audit_committee"], ["giving.monthly_view"]));
    await user.click(await screen.findByText("amina@example.com"));
    expect(await screen.findByText("History")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop this monthly gift" })).not.toBeInTheDocument();
  });

  test("Compliance stops it with a reason", async () => {
    const user = userEvent.setup();
    renderAs(staffWith(["compliance_officer"], ["giving.monthly_view", "giving.monthly_cancel"]));
    await user.click(await screen.findByText("amina@example.com"));
    await user.click(await screen.findByRole("button", { name: "Stop this monthly gift" }));
    const stop = screen.getByRole("button", { name: "Stop it" });
    expect(stop).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), "Linked to a pattern under review.");
    await user.click(stop);
    await waitFor(() => expect(mockedApiFetchJson.mock.calls.some(([p]) => p === "/recurring-gifts/g1/cancel")).toBe(true));
    const [, init] = mockedApiFetchJson.mock.calls.find(([p]) => p === "/recurring-gifts/g1/cancel")!;
    expect(JSON.parse(init!.body as string)).toEqual({ reason: "Linked to a pattern under review." });
  });

  test("a role without access is told so", async () => {
    renderAs(staffWith(["platform_admin"], []));
    expect(await screen.findByText("Not available to your role")).toBeInTheDocument();
  });
});
