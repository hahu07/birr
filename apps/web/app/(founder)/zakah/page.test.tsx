import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { draftRulesets, type ZakahRuleset, type ZakahRulings } from "@birr/zakah";
import ZakahCalculatorPage from "./page";

// Reveal's scroll animation needs browser APIs jsdom lacks — the same
// pass-through mock the vaults page test uses.
vi.mock("../SiteChrome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SiteChrome")>();
  return { ...actual, Reveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, apiFetch: vi.fn(), apiFetchJson: vi.fn() };
});

import { ApiError, apiFetchJson } from "../../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

function approved(madhhab: "maliki" | "hanafi", rulings: Partial<ZakahRulings> = {}): ZakahRuleset {
  return {
    ...draftRulesets[madhhab],
    approval: { status: "approved", approvedAt: "2026-11-01", governedActionId: `ga-${madhhab}` },
    rulings: { ...draftRulesets[madhhab].rulings, nisabBasis: "silver", ...rulings },
  };
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
// Illustrative prices: silver nisab (595g) = ₦1,190,000; gold nisab (85g) = ₦12,750,000.
const freshPrices = { goldPerGram: "150000", silverPerGram: "2000", asOf: today, source: "Test source", freshness: { ageDays: 0, status: "fresh" } };

const openTerms = { available: true, currency: "NGN", minimumAmount: "100", wakalah: { version: "v-test", text: "I appoint Birr as my agent." } };

function setup({
  rulesets = [approved("maliki"), approved("hanafi")],
  prices = freshPrices as unknown,
  terms = openTerms as unknown,
  fitrCampaign = null as unknown,
}: { rulesets?: ZakahRuleset[]; prices?: unknown; terms?: unknown; fitrCampaign?: unknown } = {}) {
  mockedApiFetchJson.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/zakah-payments/terms") return terms ? Promise.resolve(terms) : Promise.reject(new Error("down"));
    if (path === "/zakah/fitr-campaigns/current") {
      return fitrCampaign ? Promise.resolve(fitrCampaign) : Promise.reject(new ApiError("No Zakah al-Fitr campaign has been approved yet.", 404));
    }
    if (path === "/zakah-payments" && init?.method === "POST") return Promise.resolve({ payment: { id: "p-1" }, clientPayload: { checkoutUrl: "https://checkout.paystack.test/p" } });
    if (path === "/zakah/rulesets/current") return Promise.resolve(rulesets);
    if (path === "/zakah/metal-prices/current") {
      return prices ? Promise.resolve(prices) : Promise.reject(new ApiError("No metal prices have been approved yet.", 404));
    }
    return Promise.reject(new Error(`Unhandled path in test: ${path}`));
  });
  return render(<ZakahCalculatorPage />);
}

async function enterAmina(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Cash and bank balances"), "3,000,000");
  await user.type(screen.getByLabelText("Business stock"), "1200000");
  await user.type(screen.getByLabelText("Debts you must pay now"), "400000");
}

// These tests type whole amounts keystroke by keystroke, which can pass
// the 5s default on a busy machine.
const openFitr = {
  id: "fc-1", season: "1448", staple: "Rice", kgPerPerson: "2.5", amountPerPerson: "2500.00",
  opensOn: "2027-02-08", closesOn: "2027-03-09", expectedEidOn: "2027-03-10", state: "open",
};

describe("Public zakah calculator", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
  });

  test("works out Amina's ₦95,000 once she confirms a full lunar year", async () => {
    const user = userEvent.setup();
    setup();
    await enterAmina(user);

    expect(screen.getByText(/to see what you owe/)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/held this wealth for a full lunar year/));

    expect(screen.getByText("₦95,000.00")).toBeInTheDocument();
    expect(screen.getByText("2.5% of ₦3,800,000.00")).toBeInTheDocument();
    expect(screen.getByText("₦1,190,000.00")).toBeInTheDocument();
  });

  test("defaults to the Maliki ruleset and says which ruleset and prices it used", async () => {
    setup();
    expect(await screen.findByLabelText("School of thought")).toHaveValue("maliki");
    expect(screen.getByText(/Uses the Maliki ruleset \(version 1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Test source/)).toBeInTheDocument();
  });

  test("owes nothing below the nisab", async () => {
    const user = userEvent.setup();
    setup({ rulesets: [approved("maliki", { nisabBasis: "gold" })] });
    await enterAmina(user);
    await user.click(screen.getByLabelText(/held this wealth for a full lunar year/));

    expect(screen.getByText("₦0.00")).toBeInTheDocument();
    expect(screen.getByText(/below the nisab/)).toBeInTheDocument();
  });

  test("counts worn jewellery under Hanafi but not Maliki", async () => {
    const user = userEvent.setup();
    setup();
    await enterAmina(user);
    await user.click(screen.getByLabelText(/held this wealth for a full lunar year/));
    await user.click(screen.getByRole("button", { name: "Add gold" }));
    // 20g of 18k: 15g pure × ₦150,000 = ₦2,250,000.
    await user.type(screen.getByLabelText("Weight (grams)"), "20");

    expect(screen.getByText("₦95,000.00")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("School of thought"), "hanafi");
    expect(screen.getByText("₦151,250.00")).toBeInTheDocument();
  });

  test("explains a figure it can't read", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText("Business stock"), "12a");
    expect(screen.getByText("Business stock: please enter a number, like 250000.")).toBeInTheDocument();
  });

  test("refuses to give a figure with prices over 31 days old", async () => {
    setup({ prices: { ...freshPrices, asOf: "2001-01-10" } });
    expect(await screen.findByText("Prices are out of date")).toBeInTheDocument();
  });

  test("says it isn't open yet when no ruleset has been approved", async () => {
    setup({ rulesets: [] });
    expect(await screen.findByText(/Shariah Supervisory Board has approved/)).toBeInTheDocument();
  });

  test("says it isn't open yet when no prices have been approved", async () => {
    setup({ prices: null });
    expect(await screen.findByText(/gold and silver prices have been approved/)).toBeInTheDocument();
  });

  test("never sends what the visitor types anywhere", async () => {
    const user = userEvent.setup();
    setup();
    await enterAmina(user);
    await waitFor(() => expect(screen.getByLabelText("Debts you must pay now")).toHaveValue("400000"));
    // Only reads of the public zakah endpoints — no request carries a
    // method or a body, so nothing typed can have been sent.
    const allowed = ["/zakah/rulesets/current", "/zakah/metal-prices/current", "/zakah-payments/terms", "/zakah/fitr-campaigns/current"];
    for (const [path, init] of mockedApiFetchJson.mock.calls) {
      expect(allowed).toContain(path);
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
    }
  });

  test("offers payment once there's zakah to pay and payments are open", async () => {
    const user = userEvent.setup();
    setup();
    await enterAmina(user);
    expect(screen.queryByText("Pay your zakah through Birr")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/held this wealth for a full lunar year/));

    expect(screen.getByText("Pay your zakah through Birr")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount to pay")).toHaveValue("95000.00");
  });

  test("says paying isn't open yet when the zakah account isn't set up", async () => {
    const user = userEvent.setup();
    setup({ terms: { ...openTerms, available: false } });
    await enterAmina(user);
    await user.click(screen.getByLabelText(/held this wealth for a full lunar year/));

    expect(screen.getByText("Paying your zakah through Birr opens soon.")).toBeInTheDocument();
    expect(screen.queryByText("Pay your zakah through Birr")).not.toBeInTheDocument();
  });

  test("still calculates when the payment terms can't be loaded", async () => {
    const user = userEvent.setup();
    setup({ terms: null });
    await enterAmina(user);
    await user.click(screen.getByLabelText(/held this wealth for a full lunar year/));
    expect(screen.getByText("₦95,000.00")).toBeInTheDocument();
  });

  describe("Zakah al-Fitr", () => {
    test("isn't shown when no campaign has been approved", async () => {
      setup();
      await screen.findByLabelText("Cash and bank balances");
      expect(screen.queryByText("Zakah al-Fitr")).not.toBeInTheDocument();
    });

    test("works out people × the amount per person and pays it as food", async () => {
      const user = userEvent.setup();
      setup({ fitrCampaign: openFitr, rulesets: [approved("maliki")] });
      const people = await screen.findByLabelText("How many people are you paying for?");
      await user.clear(people);
      await user.type(people, "4");

      expect(screen.getByText("₦10,000.00")).toBeInTheDocument();
      // No Hanafi ruleset approved, so no cash option.
      expect(screen.queryByLabelText(/Cash — passed on as money/)).not.toBeInTheDocument();

      await user.click(screen.getByLabelText(/I appoint Birr as my agent/));
      await user.click(screen.getByRole("button", { name: "Pay ₦10,000.00" }));
      await waitFor(() =>
        expect(mockedApiFetchJson.mock.calls.some(([path, init]) => path === "/zakah-payments" && init?.method === "POST")).toBe(true),
      );
      const [, init] = mockedApiFetchJson.mock.calls.find(([path, i]) => path === "/zakah-payments" && i?.method === "POST")!;
      expect(JSON.parse(init!.body as string)).toMatchObject({ kind: "fitr", fitrPeople: 4, fitrForm: "food" });
    });

    test("offers cash only when a Hanafi ruleset is approved, and sends that ruleset", async () => {
      const user = userEvent.setup();
      setup({ fitrCampaign: openFitr, rulesets: [approved("maliki"), approved("hanafi")] });
      await user.click(await screen.findByLabelText(/Cash — passed on as money/));
      await user.click(screen.getByLabelText(/I appoint Birr as my agent/));
      await user.click(screen.getByRole("button", { name: "Pay ₦2,500.00" }));
      await waitFor(() =>
        expect(mockedApiFetchJson.mock.calls.some(([path, init]) => path === "/zakah-payments" && init?.method === "POST")).toBe(true),
      );
      const [, init] = mockedApiFetchJson.mock.calls.find(([path, i]) => path === "/zakah-payments" && i?.method === "POST")!;
      expect(JSON.parse(init!.body as string)).toMatchObject({ kind: "fitr", fitrForm: "cash", rulesetKey: "hanafi", rulesetVersion: 1 });
    });

    test("tells people to give directly once payments through Birr have closed", async () => {
      setup({ fitrCampaign: { ...openFitr, state: "closed" } });
      expect(await screen.findByText(/please give it directly to someone in need before the Eid prayer/)).toBeInTheDocument();
      expect(screen.queryByLabelText("How many people are you paying for?")).not.toBeInTheDocument();
    });
  });
});
