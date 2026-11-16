import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff } from "../../../lib/ops-types";
import TeamPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../lib/api";

const mockedFetch = vi.mocked(apiFetchJson);

function member(id: string, name: string, roles: string[], status: "active" | "suspended", permissions: string[] = []): BirrStaff {
  return {
    id,
    userId: `user-${id}`,
    roles,
    permissions,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    user: { id: `user-${id}`, email: `${id}@birr.dev`, fullName: name, status: "active", mfaEnabled: true, whatsappNumber: null, whatsappVerifiedAt: null },
  } as BirrStaff;
}

const admin = member("admin", "Ada Admin", ["platform_admin"], "active", ["staff.suspend", "staff.reinstate"]);
const officer = member("officer", "Musa Officer", ["mutawalli_officer"], "active");
const leaver = member("leaver", "Lami Leaver", ["legal_adviser"], "suspended");

function rowFor(name: string) {
  return screen.getByText(name).closest("tr")!;
}

describe("Ops: Team — suspending and reinstating", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/birr-staff/me") return admin;
      if (path === "/birr-staff") return [admin, officer, leaver];
      if (path === "/invitations") return [];
      if (path === "/governed-actions") return { id: "ga-1" };
      throw new Error(path);
    });
  });

  test("suspend asks for a reason and sends it for approval; not offered on your own row", async () => {
    const user = userEvent.setup();
    render(
      <StaffSessionProvider>
        <TeamPage />
      </StaffSessionProvider>,
    );
    await screen.findByText("Musa Officer");
    expect(within(rowFor("Ada Admin")).queryByRole("button", { name: "Suspend…" })).not.toBeInTheDocument();

    await user.click(within(rowFor("Musa Officer")).getByRole("button", { name: "Suspend…" }));
    const send = screen.getByRole("button", { name: "Send for approval" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Why suspend Musa Officer?"), "Left Birr on 14 November.");
    await user.click(send);

    await waitFor(() => expect(screen.getByText("Sent for approval")).toBeInTheDocument());
    const [, init] = mockedFetch.mock.calls.find(([path]) => path === "/governed-actions")!;
    expect(JSON.parse(init!.body as string)).toEqual({ permissionKey: "staff.suspend", payload: { staffId: "officer", reason: "Left Birr on 14 November." } });
  });

  test("a suspended member offers Reinstate instead", async () => {
    render(
      <StaffSessionProvider>
        <TeamPage />
      </StaffSessionProvider>,
    );
    await screen.findByText("Lami Leaver");
    expect(within(rowFor("Lami Leaver")).getByRole("button", { name: "Reinstate…" })).toBeInTheDocument();
    expect(within(rowFor("Lami Leaver")).queryByRole("button", { name: "Suspend…" })).not.toBeInTheDocument();
  });
});
