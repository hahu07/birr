import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { draftRulesets } from "@birr/zakah";
import { StaffSessionProvider } from "../../../lib/staff-session";
import type { BirrStaff, ZakahMetalPriceRow, ZakahRulesetRow } from "../../../lib/ops-types";
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

function setup(staff: BirrStaff, { prices = [price], rulesets = [draft] }: { prices?: ZakahMetalPriceRow[]; rulesets?: ZakahRulesetRow[] } = {}) {
  mockedApiFetchJson.mockImplementation((path: string) => {
    if (path === "/birr-staff/me") return Promise.resolve(staff);
    if (path === "/zakah/metal-prices") return Promise.resolve(prices);
    if (path === "/zakah/rulesets") return Promise.resolve(rulesets);
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

describe("Ops Console — Zakah", () => {
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
