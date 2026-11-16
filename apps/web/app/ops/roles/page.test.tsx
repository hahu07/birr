import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { AccessReviewsStatus, BirrStaff, GovernedActionPermission, Role, RoleChanges, RolesOverview } from "../../../lib/ops-types";
import RolesPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../lib/api";

const mocked = vi.mocked(apiFetchJson);

function staffWith(roles: string[], permissions: string[]): BirrStaff {
  return {
    id: "staff-1", userId: "user-1", roles, permissions, status: "active",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    user: { id: "user-1", email: "staff@example.com", fullName: "Test Staff", status: "active", mfaEnabled: true, whatsappNumber: null, whatsappVerifiedAt: null },
  } as BirrStaff;
}

const perm = (key: string, category: string, description: string, requiresMakerChecker: boolean): GovernedActionPermission => ({
  id: key, key, category, description, requiresMakerChecker,
});
const permissions = [
  perm("vault.distribution_approve", "vault", "Approve a vault distribution to a delivery-partner counterparty.", true),
  perm("vault.curate", "vault", "Create and edit vaults and their causes.", false),
  perm("waqf.view", "waqf", "View waqf details. Not maker-checker gated.", false),
  // No role holds this one: it must still be offered.
  perm("compliance.report_export", "compliance", "Export a compliance report.", false),
];
const grant = (key: string, canMaker: boolean, canChecker = false) => ({ canMaker, canChecker, permission: permissions.find((p) => p.key === key)! });
const roles: Role[] = [
  { id: "r1", key: "mutawalli_officer", name: "Mutawalli Officer", description: "Case-carrying trustee officer.", rolePermissions: [grant("vault.distribution_approve", true), grant("vault.curate", true), grant("waqf.view", true)] },
  { id: "r2", key: "board_of_trustees", name: "Board of Trustees", description: "Apex governance body.", rolePermissions: [grant("vault.distribution_approve", false, true)] },
];
const overview: RolesOverview = {
  roles,
  permissions,
  holders: {
    mutawalli_officer: [{ id: "s1", fullName: "Aisha Bello", email: "aisha@example.com" }, { id: "s2", fullName: "Musa Sani", email: "musa@example.com" }],
    board_of_trustees: [{ id: "s3", fullName: "Halima Yusuf", email: "halima@example.com" }],
  },
};
const changes: RoleChanges = {
  pending: [],
  history: [
    {
      id: "g1", status: "approved", changes: [{ roleKey: "mutawalli_officer", permissionKey: "vault.curate", canMaker: true, canChecker: false }],
      reason: "Officers curate Vaults day to day.", proposedBy: "Ada Admin", decidedBy: "Halima Yusuf", proposedAt: "2026-11-01T09:00:00.000Z", decidedAt: "2026-11-02T09:00:00.000Z",
    },
  ],
  page: 1,
  hasMore: false,
};
const reviews: AccessReviewsStatus = { intervalDays: 90, lastCompletedAt: null, nextDueAt: null, reviews: [] };

function setup(staff: BirrStaff, preview: (body: { changes: Record<string, unknown>[] }) => unknown = (b) => ({
  checks: b.changes.map((c) => ({ ...c, roleName: "Mutawalli Officer", permissionDescription: null, requiresMakerChecker: false, before: { canMaker: false, canChecker: false }, problem: null, affectedPeople: 2 })),
})) {
  mocked.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/birr-staff/me") return staff;
    if (path === "/roles") return overview;
    if (path === "/roles/changes") return changes;
    if (path === "/roles/access-reviews") return reviews;
    if (path === "/roles/permission-changes/preview") return preview(JSON.parse(init!.body as string));
    if (path === "/governed-actions" || path === "/roles/access-reviews") return {};
    throw new Error(`Unhandled path in test: ${path}`);
  });
  render(
    <StaffSessionProvider>
      <RolesPage />
    </StaffSessionProvider>,
  );
  return userEvent.setup();
}

const admin = () => staffWith(["platform_admin"], ["roles.view", "role.permission_change"]);
const sentTo = (path: string) => mocked.mock.calls.find(([p, i]) => p === path && i?.method === "POST")?.[1];

describe("Roles & Access", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mocked.mockReset();
  });

  test("shows a role's people and permissions by area, with readable names, including one no role holds", async () => {
    setup(staffWith(["audit_committee"], ["roles.view"]));
    expect(await screen.findByRole("heading", { name: "Mutawalli Officer" })).toBeInTheDocument();
    expect(screen.getByText("Aisha Bello")).toBeInTheDocument();
    expect(screen.getByText("View waqf details.")).toBeInTheDocument();
    expect(screen.getByText("Export a compliance report.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Vaults" })).toBeInTheDocument();
    // View only without role.permission_change: no switches.
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  test("each control starts from the current grant: approval actions offer None/Proposes/Approves, access offers Off/On", async () => {
    setup(admin());
    const approval = await screen.findByRole("radiogroup", { name: /Approve a vault distribution.*Mutawalli Officer/ });
    expect(within(approval).getAllByRole("radio").map((r) => r.textContent)).toEqual(["None", "Proposes", "Approves"]);
    expect(within(approval).getByRole("radio", { name: "Proposes" })).toHaveAttribute("aria-checked", "true");
    const access = screen.getByRole("radiogroup", { name: /Export a compliance report.*Mutawalli Officer/ });
    expect(within(access).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Off", "On"]);
    expect(within(access).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/not yet sent/)).not.toBeInTheDocument();
  });

  test("an edit is staged and can be undone; nothing is sent until reviewed", async () => {
    const user = setup(admin());
    const access = await screen.findByRole("radiogroup", { name: /Export a compliance report.*Mutawalli Officer/ });
    await user.click(within(access).getByRole("radio", { name: "On" }));
    expect(screen.getByText("1 change to 1 role, not yet sent")).toBeInTheDocument();
    expect(screen.getByText(/Was Off/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText(/not yet sent/)).not.toBeInTheDocument();
    expect(sentTo("/governed-actions")).toBeUndefined();
  });

  test("the review runs the safety checks, blocks sending while any fails, and needs a reason", async () => {
    const user = setup(admin(), (b) => ({
      checks: b.changes.map((c) => ({
        ...c, roleName: "Board of Trustees", permissionDescription: null, requiresMakerChecker: true, before: { canMaker: false, canChecker: true }, affectedPeople: 1,
        problem: "That would leave nobody active able to approve vault.distribution_approve — it could never be approved again.",
      })),
    }));
    await user.click(await screen.findByRole("button", { name: /Board of Trustees/ }));
    const approval = await screen.findByRole("radiogroup", { name: /Approve a vault distribution.*Board of Trustees/ });
    await user.click(within(approval).getByRole("radio", { name: "None" }));
    await user.click(screen.getByRole("button", { name: "Review & send" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/nobody active able to approve/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Why are these changes needed?"), "Board no longer approves these.");
    expect(within(dialog).getByRole("button", { name: "Send for approval" })).toBeDisabled();
  });

  test("changes to two roles go as one proposal, with the reason", async () => {
    const user = setup(admin());
    await user.click(within(await screen.findByRole("radiogroup", { name: /Export a compliance report.*Mutawalli Officer/ })).getByRole("radio", { name: "On" }));
    await user.click(screen.getByRole("button", { name: /Board of Trustees/ }));
    await user.click(within(await screen.findByRole("radiogroup", { name: /View waqf details.*Board of Trustees/ })).getByRole("radio", { name: "On" }));
    expect(screen.getByText("2 changes to 2 roles, not yet sent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review & send" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findAllByText(/affects 2 people/)).toHaveLength(2);
    const send = within(dialog).getByRole("button", { name: "Send for approval" });
    await user.type(within(dialog).getByLabelText("Why are these changes needed?"), "short");
    expect(send).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Why are these changes needed?"), " — Compliance needs the report for the NG regulator.");
    await user.click(send);

    await waitFor(() => expect(sentTo("/governed-actions")).toBeDefined());
    expect(JSON.parse(sentTo("/governed-actions")!.body as string)).toEqual({
      permissionKey: "role.permission_change",
      payload: {
        changes: [
          { roleKey: "mutawalli_officer", permissionKey: "compliance.report_export", canMaker: true, canChecker: false },
          { roleKey: "board_of_trustees", permissionKey: "waqf.view", canMaker: true, canChecker: false },
        ],
        reason: "short — Compliance needs the report for the NG regulator.",
      },
    });
    expect(await screen.findByText("Sent for approval")).toBeInTheDocument();
  });

  test("By permission lists who proposes and approves, and searches", async () => {
    const user = setup(staffWith(["compliance_officer"], ["roles.view"]));
    await user.click(await screen.findByRole("tab", { name: "By permission" }));
    const row = screen.getByText("Approve a vault distribution to a delivery-partner counterparty.").closest("li")!;
    expect(within(row).getByText("Proposes").nextSibling).toHaveTextContent("Mutawalli Officer");
    expect(within(row).getByText("Approves").nextSibling).toHaveTextContent("Board of Trustees");
    await user.type(screen.getByLabelText("Search permissions"), "compliance");
    expect(screen.getByText("1 of 4")).toBeInTheDocument();
  });

  test("Changes shows the history with its reason and who decided", async () => {
    const user = setup(staffWith(["audit_committee"], ["roles.view"]));
    await user.click(await screen.findByRole("tab", { name: "Changes" }));
    expect(screen.getByText("Officers curate Vaults day to day.")).toBeInTheDocument();
    expect(screen.getByText(/Approved by Halima Yusuf/)).toBeInTheDocument();
  });

  test("the access review needs every role decided, and a note where something needs changing", async () => {
    const user = setup(staffWith(["board_of_trustees"], ["roles.view", "roles.access_review"]));
    await user.click(await screen.findByRole("tab", { name: "Access reviews (due)" }));
    await user.click(screen.getByRole("button", { name: "Start review" }));
    const complete = screen.getByRole("button", { name: "Complete review" });
    await user.click(within(screen.getByRole("radiogroup", { name: "Mutawalli Officer outcome" })).getByRole("radio", { name: "Confirmed" }));
    expect(complete).toBeDisabled();
    await user.click(within(screen.getByRole("radiogroup", { name: "Board of Trustees outcome" })).getByRole("radio", { name: "Needs change" }));
    expect(complete).toBeDisabled();
    await user.type(screen.getByLabelText("What needs changing?"), "Board should not hold vault.curate.");
    await user.click(complete);
    await waitFor(() => expect(sentTo("/roles/access-reviews")).toBeDefined());
    expect(JSON.parse(sentTo("/roles/access-reviews")!.body as string)).toEqual({
      outcomes: [
        { roleKey: "mutawalli_officer", outcome: "confirmed", note: null },
        { roleKey: "board_of_trustees", outcome: "changes_needed", note: "Board should not hold vault.curate." },
      ],
    });
  });
});
