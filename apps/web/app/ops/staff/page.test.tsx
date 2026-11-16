import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff, Invitation, StaffChangeEntry } from "../../../lib/ops-types";
import TeamPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../lib/api";

const mocked = vi.mocked(apiFetchJson);
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function member(id: string, name: string, roles: string[], status: "active" | "suspended", extra: Partial<BirrStaff["user"]> = {}, permissions: string[] = []): BirrStaff {
  return {
    id, userId: `user-${id}`, roles, permissions, status, createdAt: ago(400), updatedAt: ago(1),
    user: { id: `user-${id}`, email: `${id}@birr.dev`, fullName: name, status: "active", mfaEnabled: true, whatsappNumber: null, whatsappVerifiedAt: null, lastSignInAt: ago(2), ...extra },
  } as BirrStaff;
}

const MANAGER = ["staff.suspend", "staff.reinstate", "staff.role_add", "staff.role_remove", "staff.mfa_reset", "staff.invite", "staff.invitation_manage", "roles.view"];
const admin = member("admin", "Ada Admin", ["platform_admin"], "active", {}, MANAGER);
const officer = member("officer", "Musa Officer", ["mutawalli_officer", "legal_adviser"], "active");
const leaver = member("leaver", "Lami Leaver", ["legal_adviser"], "suspended");
const sleeper = member("sleeper", "Sule Sleeper", ["audit_committee"], "active", { lastSignInAt: ago(120) });
const noTwoFactor = member("fresh", "Fatima Fresh", ["compliance_officer"], "active", { mfaEnabled: false });
const pendingChange: StaffChangeEntry = {
  id: "ga-9", kind: "role_add", status: "proposed", staffId: "sleeper", email: null, role: "board_of_trustees", reason: "Joining the Board in December.",
  proposedBy: "Ada Admin", decidedBy: null, proposedAt: ago(1), decidedAt: null,
};
const invitation = { id: "inv-1", inviteeKind: "birr_staff", email: "new@birr.dev", founderId: null, roleKey: "legal_adviser", invitedBy: "user-admin", status: "pending", expiresAt: ago(-5), createdAt: ago(2), token: null } as Invitation;

function setup(me: BirrStaff = admin) {
  mocked.mockImplementation(async (path: string) => {
    if (path === "/birr-staff/me") return me;
    if (path === "/birr-staff") return [admin, officer, leaver, sleeper, noTwoFactor];
    if (path === "/invitations") return [invitation];
    if (path === "/birr-staff/pending-changes") return [pendingChange];
    if (path.endsWith("/history")) return [{ ...pendingChange, id: "ga-1", kind: "invite", status: "approved", role: "mutawalli_officer", reason: "Second officer for Kano.", decidedBy: "Halima Board", decidedAt: ago(300) }];
    if (path === "/governed-actions" || path.endsWith("/revoke")) return { id: "ga-new" };
    throw new Error(path);
  });
  render(
    <StaffSessionProvider>
      <TeamPage />
    </StaffSessionProvider>,
  );
  return userEvent.setup();
}

const body = (path: string) => JSON.parse(mocked.mock.calls.find(([p, i]) => p === path && i?.method === "POST")![1]!.body as string);
const openMember = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  return screen.getByRole("dialog");
};

describe("Ops: Team", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mocked.mockReset();
  });

  test("flags who needs attention, and what's awaiting approval", async () => {
    const user = setup();
    await screen.findByText("Musa Officer");
    const sleeperRow = screen.getByRole("button", { name: /Sule Sleeper/ });
    expect(within(sleeperRow).getByText("No sign-in 90+ days")).toBeInTheDocument();
    expect(within(sleeperRow).getByText(/Awaiting: Add Board of trustees/i)).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Fatima Fresh/ })).getByText("No two-factor")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Show"), "attention");
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Musa Officer/ })).not.toBeInTheDocument();
  });

  test("removing a role takes a confirm step with a reason, and sends the reason", async () => {
    const user = setup();
    const panel = await openMember(user, "Musa Officer");
    await user.click(within(panel).getByRole("button", { name: "Remove a role…" }));
    const form = within(panel).getByRole("group", { name: "Remove a role from Musa Officer" });
    expect(within(form).getByText(/loses everything the role allowed/)).toBeInTheDocument();
    const send = within(form).getByRole("button", { name: "Send for approval" });
    await user.selectOptions(within(form).getByLabelText("Role"), "legal_adviser");
    expect(send).toBeDisabled();
    await user.type(within(form).getByLabelText("Why?"), "Moved to the investment team in November.");
    await user.click(send);
    await waitFor(() => expect(within(panel).getByText("Sent for approval")).toBeInTheDocument());
    expect(body("/governed-actions")).toEqual({
      permissionKey: "staff.role_remove",
      payload: { staffId: "officer", role: "legal_adviser", reason: "Moved to the investment team in November." },
    });
  });

  test("a two-factor reset says to confirm through a separate channel and needs a reason", async () => {
    const user = setup();
    const panel = await openMember(user, "Musa Officer");
    await user.click(within(panel).getByRole("button", { name: "Reset two-factor…" }));
    expect(within(panel).getByText(/through a separate channel/)).toBeInTheDocument();
    await user.type(within(panel).getByLabelText("Why?"), "Lost his phone; confirmed by a call on 16 Nov.");
    await user.click(within(panel).getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(body("/governed-actions")).toMatchObject({ permissionKey: "staff.mfa_reset", payload: { staffId: "officer", reason: "Lost his phone; confirmed by a call on 16 Nov." } }));
  });

  test("with a change awaiting approval, no other change is offered until it's decided; history shows reasons", async () => {
    const user = setup();
    const panel = await openMember(user, "Sule Sleeper");
    expect(within(panel).getByText(/awaiting approval\. It has to be decided first/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Suspend…" })).not.toBeInTheDocument();
    expect(await within(panel).findByText("“Second officer for Kano.”")).toBeInTheDocument();
    expect(within(panel).getByText(/decided by Halima Board/)).toBeInTheDocument();
  });

  test("nobody proposes changes to their own account", async () => {
    const user = setup();
    const panel = await openMember(user, "Ada Admin");
    expect(within(panel).getByText(/can't propose changes to your own account/)).toBeInTheDocument();
  });

  test("suspended staff are one filter away, and offer Reinstate, not Suspend", async () => {
    const user = setup();
    await screen.findByText("Musa Officer");
    expect(screen.queryByRole("button", { name: /Lami Leaver/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Show"), "suspended");
    const panel = await openMember(user, "Lami Leaver");
    expect(within(panel).getByRole("button", { name: "Reinstate…" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Suspend…" })).not.toBeInTheDocument();
  });

  test("an invitation needs a reason; revoking one asks first", async () => {
    const user = setup();
    await user.click(await screen.findByRole("button", { name: "Invite staff member" }));
    await user.type(screen.getByLabelText("Email"), "aisha@birr.dev");
    const send = screen.getByRole("button", { name: "Send for approval" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Why are they joining?"), "Second compliance officer for launch.");
    await user.click(send);
    await waitFor(() => expect(body("/governed-actions")).toEqual({ permissionKey: "staff.invite", payload: { email: "aisha@birr.dev", staffRole: "mutawalli_officer", reason: "Second compliance officer for launch." } }));

    await user.click(screen.getByRole("button", { name: "Revoke…" }));
    expect(screen.getByText(/The link stops working/)).toBeInTheDocument();
    expect(mocked.mock.calls.some(([p]) => p === "/invitations/inv-1/revoke")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(mocked.mock.calls.some(([p]) => p === "/invitations/inv-1/revoke")).toBe(true));
  });
});
