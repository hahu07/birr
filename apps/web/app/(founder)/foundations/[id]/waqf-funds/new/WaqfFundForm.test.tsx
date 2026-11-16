import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaqfFundForm } from "./WaqfFundForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { apiFetchJson } from "../../../../../../lib/api";

const mockedFetch = vi.mocked(apiFetchJson);

// Yusra Fund from the screenshot: an installment plan, ₦625,000 of ₦800,000 raised.
const nearTarget = {
  id: "w1", name: "Yusra Fund", corpusAmount: "800000", corpusCurrency: "NGN", fundingPlan: "installment" as const, amountRaised: "625000",
};

describe("WaqfFundForm — a top-up near the target", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/waqf-funding/contribution-minimums") return [{ currency: "NGN", minAmount: "5000" }];
      if (path === "/waqf-funding/corpus-minimums") return [{ currency: "NGN", minAmount: "250000" }];
      if (path === "/waqf-funding/settings") return { installmentMinimumPercent: "25" };
      throw new Error(`Unhandled path in test: ${path}`);
    });
  });

  test("says the founder can pay exactly what's left, and one click fills it in", async () => {
    render(<WaqfFundForm foundationId="f1" existingWaqf={nearTarget} />);
    expect(await screen.findByText(/Minimum ₦5,000, or the ₦175,000.00 left to reach your ₦800,000 target\./)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Pay the ₦175,000.00 left" }));
    expect(screen.getByLabelText(/Amount/)).toHaveValue(175000);
  });

  test("no such offer once the target is reached", async () => {
    render(<WaqfFundForm foundationId="f1" existingWaqf={{ ...nearTarget, amountRaised: "800000" }} />);
    expect(await screen.findByText("Minimum ₦5,000.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay the/ })).not.toBeInTheDocument();
  });
});
