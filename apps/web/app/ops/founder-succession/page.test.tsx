import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff } from "../../../lib/ops-types";
import FounderSuccessionPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../lib/api";

const mockedFetch = vi.mocked(apiFetchJson);
let currentStaff: BirrStaff;

function staffWith(permissions: string[]): BirrStaff {
  return {
    id: "s1",
    userId: "u9",
    roles: ["mutawalli_officer"],
    permissions,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    user: { id: "u9", email: "m@birr.dev", fullName: "Officer", status: "active", mfaEnabled: true, whatsappNumber: null, whatsappVerifiedAt: null },
  } as BirrStaff;
}

const succession = {
  id: "c1",
  founderId: "f1",
  founder: { id: "f1", name: "Kaduna Family Foundation" },
  kind: "unreachable",
  status: "requested",
  outgoingMembershipId: "m1",
  newMembershipId: "m2",
  newEmail: null,
  newFullName: null,
  reason: "Our chairman passed away on 2 November.",
  evidenceNote: "Death certificate No. 4471, seen 12 Nov.",
  requestedByUserId: "u2",
  outgoingNotifiedAt: "2026-11-03T10:00:00.000Z",
  earliestApprovalAt: "2026-11-10T10:00:00.000Z",
  objectedAt: null,
  objectionNote: null,
  completedAt: null,
  createdAt: "2026-11-03T10:00:00.000Z",
  outgoingMembership: { id: "m1", user: { id: "u1", fullName: "Alhaji Musa", email: "u1@example.com" } },
  newMembership: { id: "m2", user: { id: "u2", fullName: "Hauwa Musa", email: "u2@example.com" } },
  requestedBy: { fullName: "Hauwa Musa" },
  recordedBy: null,
  pendingApproval: null,
};

function renderAs(staff: BirrStaff) {
  currentStaff = staff;
  render(
    <StaffSessionProvider>
      <FounderSuccessionPage />
    </StaffSessionProvider>,
  );
}

describe("Ops: Primary Contact Changes", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/birr-staff/me") return currentStaff;
      if (path === "/staff/founder-succession") return [succession];
      if (path === "/governed-actions") return { id: "ga1" };
      if (path === "/staff/founder-succession/c1/close") return { ...succession, status: "cancelled" };
      throw new Error(path);
    });
  });

  test("shows the case with its evidence and notice period; viewers can't act", async () => {
    renderAs(staffWith(["founder.succession_view"]));
    expect(await screen.findByText(/Alhaji Musa → Hauwa Musa/)).toBeInTheDocument();
    expect(screen.getByText(/Death certificate No\. 4471/)).toBeInTheDocument();
    expect(screen.getByText(/can object until/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose change" })).toBeNull();
    expect(screen.queryByRole("button", { name: /record a request/i })).toBeNull();
  });

  test("a Mutawalli Officer proposes the governed change and can close with a note", async () => {
    renderAs(staffWith(["founder.succession_view", "founder.succession_record", "founder.primary_contact_change"]));
    await userEvent.click(await screen.findByRole("button", { name: "Propose change" }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("/governed-actions", {
        method: "POST",
        body: JSON.stringify({ permissionKey: "founder.primary_contact_change", payload: { successionId: "c1" } }),
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Close…" }));
    await userEvent.type(screen.getByLabelText(/why it's being closed/i), "Family withdrew the request by phone.");
    await userEvent.click(screen.getByRole("button", { name: "Close request" }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("/staff/founder-succession/c1/close", { method: "POST", body: JSON.stringify({ note: "Family withdrew the request by phone." }) }),
    );
  });

  test("once proposed, it points to Approvals instead of proposing again", async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/birr-staff/me") return currentStaff;
      if (path === "/staff/founder-succession") return [{ ...succession, pendingApproval: { id: "ga1", proposedBy: "Officer" } }];
      throw new Error(path);
    });
    renderAs(staffWith(["founder.succession_view", "founder.primary_contact_change"]));
    expect(await screen.findByText("Decide it in Approvals")).toBeInTheDocument();
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose change" })).toBeNull();
  });
});
