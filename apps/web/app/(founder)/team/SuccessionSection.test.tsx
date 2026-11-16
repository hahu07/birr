import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuccessionSection } from "./SuccessionSection";
import type { FounderMembership, PrimaryContactSuccession } from "../../../lib/types";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../lib/api";

const mockedFetch = vi.mocked(apiFetchJson);

const member = (id: string, userId: string, fullName: string, permissionLevel: FounderMembership["permissionLevel"]): FounderMembership => ({
  id,
  founderId: "f1",
  userId,
  permissionLevel,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
  user: { id: userId, fullName, email: `${userId}@example.com`, mfaEnabled: false },
});
const members = [member("m1", "u1", "Aisha Bello", "primary_contact"), member("m2", "u2", "Musa Danjuma", "viewer")];

const openCase: PrimaryContactSuccession = {
  id: "s1",
  founderId: "f1",
  kind: "unreachable",
  status: "requested",
  outgoingMembershipId: "m1",
  newMembershipId: "m2",
  newEmail: null,
  newFullName: null,
  reason: "Our bursar has not been reachable since September.",
  evidenceNote: "Letters returned; phone off.",
  requestedByUserId: "u2",
  outgoingNotifiedAt: "2026-11-15T10:00:00.000Z",
  earliestApprovalAt: "2026-11-22T10:00:00.000Z",
  objectedAt: null,
  objectionNote: null,
  completedAt: null,
  createdAt: "2026-11-15T10:00:00.000Z",
  outgoingMembership: { id: "m1", user: { id: "u1", fullName: "Aisha Bello", email: "u1@example.com" } },
  newMembership: { id: "m2", user: { id: "u2", fullName: "Musa Danjuma", email: "u2@example.com" } },
  requestedBy: { fullName: "Musa Danjuma" },
};

describe("Team: primary contact succession", { timeout: 20_000 }, () => {
  beforeEach(() => mockedFetch.mockReset());

  test("the primary contact can hand over to a member or someone new, with a reason", async () => {
    mockedFetch.mockImplementation(async (path: string) => (path === "/founder-succession" ? [] : {}));
    render(<SuccessionSection members={members} userId="u1" isPrimaryContact onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /hand over primary contact/i }));
    expect(screen.queryByRole("button", { name: /can't act/i })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Who takes over"), "new");
    await userEvent.type(screen.getByLabelText("Their full name"), "Zainab Sule");
    await userEvent.type(screen.getByLabelText("Their email"), "zainab@example.com");
    await userEvent.type(screen.getByLabelText("Reason"), "I retire as Bursar on 31 December.");
    expect(screen.queryByLabelText(/evidence/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Send to Birr" }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("/founder-succession/handover", {
        method: "POST",
        body: JSON.stringify({ newEmail: "zainab@example.com", newFullName: "Zainab Sule", reason: "I retire as Bursar on 31 December." }),
      }),
    );
  });

  test("another member reports the contact can't act, with evidence", async () => {
    mockedFetch.mockImplementation(async (path: string) => (path === "/founder-succession" ? [] : {}));
    render(<SuccessionSection members={members} userId="u2" isPrimaryContact={false} onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /our primary contact can't act/i }));
    expect(screen.getByLabelText("Who takes over")).toHaveValue("m2");
    await userEvent.type(screen.getByLabelText("Reason"), "Our chairman passed away on 2 November.");
    await userEvent.type(screen.getByLabelText(/evidence/i), "Death certificate available.");
    await userEvent.click(screen.getByRole("button", { name: "Send to Birr" }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("/founder-succession/unavailable", {
        method: "POST",
        body: JSON.stringify({ newMembershipId: "m2", reason: "Our chairman passed away on 2 November.", evidenceNote: "Death certificate available." }),
      }),
    );
  });

  test("the outgoing contact sees the request and can object", async () => {
    mockedFetch.mockImplementation(async (path: string) => (path === "/founder-succession" ? [openCase] : {}));
    render(<SuccessionSection members={members} userId="u1" isPrimaryContact onChanged={() => {}} />);
    expect(await screen.findByText(/asked Birr to replace you/i)).toBeInTheDocument();
    // An open case replaces the request buttons.
    expect(screen.queryByRole("button", { name: /hand over/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /withdraw/i })).toBeNull();
    await userEvent.type(screen.getByLabelText("Why this is wrong"), "I am well and still in post.");
    await userEvent.click(screen.getByRole("button", { name: "Object" }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("/founder-succession/s1/object", { method: "POST", body: JSON.stringify({ note: "I am well and still in post." }) }),
    );
  });

  test("whoever asked can withdraw; others only see the status", async () => {
    mockedFetch.mockImplementation(async (path: string) => (path === "/founder-succession" ? [openCase] : {}));
    const { unmount } = render(<SuccessionSection members={members} userId="u2" isPrimaryContact={false} onChanged={() => {}} />);
    expect(await screen.findByText(/can object until/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Why this is wrong")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith("/founder-succession/s1/cancel", { method: "POST", body: undefined }));
    unmount();
  });
});
