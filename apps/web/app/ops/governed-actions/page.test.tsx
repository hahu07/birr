// Regression coverage for the two fiduciary-UX fixes shipped on this
// page (2026-09-08): a checker must expand a row's payload before
// Approve/Reject become clickable, and a decision requires confirming a
// native window.confirm before the request is ever sent. This is the one
// screen the Trust Ledger Audit scrutinized hardest, so it's the natural
// first real test rather than an arbitrary starting point.
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff } from "../../../lib/ops-types";
import type { GovernedAction } from "../../../lib/ops-types";
import GovernedActionsPage from "./page";

vi.mock("../../../lib/api", () => ({
  apiFetch: vi.fn(),
  apiFetchJson: vi.fn(),
}));

import { apiFetchJson } from "../../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

const fakeStaff: BirrStaff = {
  id: "staff-1",
  userId: "user-checker",
  staffRole: "compliance_officer",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  user: {
    id: "user-checker",
    email: "checker@example.com",
    fullName: "Test Checker",
    status: "active",
    mfaEnabled: false,
    whatsappNumber: null,
    whatsappVerifiedAt: null,
  },
};

const fakeAction: GovernedAction = {
  id: "action-1",
  waqfId: "waqf-1",
  permissionId: "perm-1",
  makerType: "human",
  makerUserId: "user-maker",
  makerAgentId: null,
  checkerUserId: null,
  status: "proposed",
  payload: { assetId: "asset-1", reason: "Sold to fund a distribution" },
  createdAt: "2026-09-08T00:00:00.000Z",
  decidedAt: null,
  permission: { id: "perm-1", key: "asset.dispose", description: null, category: "asset", requiresMakerChecker: true },
  makerUser: { id: "user-maker", fullName: "Test Maker", email: "maker@example.com" },
  makerAgent: null,
  checkerUser: null,
  waqf: { id: "waqf-1", name: "Test Waqf" },
  proposedFoundation: null,
  summary: null,
};

function routeApiFetchJson(path: string) {
  if (path === "/birr-staff/me") return Promise.resolve(fakeStaff);
  if (path.startsWith("/governed-actions?status=proposed")) return Promise.resolve([fakeAction]);
  if (path === "/notifications/mark-read-for-entity") return Promise.resolve({});
  if (path === "/governed-actions/action-1/decide") return Promise.resolve({});
  return Promise.reject(new Error(`Unhandled path in test: ${path}`));
}

function renderPage() {
  return render(
    <StaffSessionProvider>
      <GovernedActionsPage />
    </StaffSessionProvider>,
  );
}

describe("GovernedActionsPage", () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
    mockedApiFetchJson.mockImplementation(routeApiFetchJson);
  });

  test("Approve/Reject are disabled until the row's payload has been expanded, then become enabled", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Asset · Dispose");

    const approveButton = screen.getByRole("button", { name: "Approve" });
    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(approveButton).toBeDisabled();
    expect(rejectButton).toBeDisabled();
    expect(screen.getByText("Expand to review before deciding")).toBeInTheDocument();

    await user.click(screen.getByText("Asset · Dispose"));

    await waitFor(() => {
      expect(approveButton).toBeEnabled();
      expect(rejectButton).toBeEnabled();
    });
    expect(screen.queryByText("Expand to review before deciding")).not.toBeInTheDocument();
    // The expanded payload itself is now visible, not hidden behind
    // another click — the other half of the same audit finding.
    expect(screen.getByText("asset-1")).toBeInTheDocument();
  });

  test("clicking Approve requires window.confirm, and sends no request if the officer cancels", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();

    await screen.findByText("Asset · Dispose");
    await user.click(screen.getByText("Asset · Dispose"));
    const approveButton = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => expect(approveButton).toBeEnabled());

    await user.click(approveButton);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockedApiFetchJson).not.toHaveBeenCalledWith("/governed-actions/action-1/decide", expect.anything());
  });

  test("clicking Approve sends the decide request once the officer confirms", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    await screen.findByText("Asset · Dispose");
    await user.click(screen.getByText("Asset · Dispose"));
    const approveButton = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => expect(approveButton).toBeEnabled());

    await user.click(approveButton);

    await waitFor(() => {
      expect(mockedApiFetchJson).toHaveBeenCalledWith(
        "/governed-actions/action-1/decide",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ approve: true }) }),
      );
    });
  });
});
