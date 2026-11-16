import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthlyTopUpSection } from "./MonthlyTopUpSection";
import type { Waqf } from "../../../../lib/types";

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { ApiError, apiFetchJson } from "../../../../lib/api";

const mockedFetch = vi.mocked(apiFetchJson);

const waqf = { id: "w1", status: "active", corpusCurrency: "NGN", amountRaised: "1000000" } as Waqf;

const running = {
  status: "active",
  pauseReason: null,
  email: "amina@example.com",
  amount: "250000",
  currency: "NGN",
  dayOfMonth: 15,
  nextChargeAt: "2026-12-15T08:00:00.000Z",
  card: { last4: "4081", brand: "visa", expMonth: 12, expYear: 2030 },
  cardUpdateInProgress: false,
  minimumAmount: "250000",
  charges: [],
};

describe("MonthlyTopUpSection", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  });

  test("isn't offered before the fund's first contribution", () => {
    mockedFetch.mockResolvedValue(null);
    const { container } = render(<MonthlyTopUpSection waqf={{ ...waqf, amountRaised: "0" } as Waqf} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("setting one up goes to a card checkout with monthly: true", async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/waqfs/w1/monthly-top-up") return null;
      if (path.includes("contribution-minimums")) return [{ currency: "NGN", minAmount: "250000" }];
      if (path === "/contributions") return { clientPayload: { checkoutUrl: "https://checkout.test/w" } };
      throw new Error(path);
    });
    const user = userEvent.setup();
    render(<MonthlyTopUpSection waqf={waqf} />);
    await user.type(await screen.findByLabelText("Monthly top-up amount"), "250000");
    await user.click(screen.getByRole("button", { name: "Set up monthly top-up" }));
    await waitFor(() => expect(window.location.href).toBe("https://checkout.test/w"));
    const [, init] = mockedFetch.mock.calls.find(([path]) => path === "/contributions")!;
    expect(JSON.parse(init!.body as string)).toEqual({ waqfId: "w1", amount: "250000", currency: "NGN", provider: "paystack", monthly: true });
  });

  test("a running top-up shows its next date and card, and can be stopped after confirming", async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/waqfs/w1/monthly-top-up") return running;
      if (path === "/waqfs/w1/monthly-top-up/cancel") return { ...running, status: "cancelled" };
      throw new Error(path);
    });
    const user = userEvent.setup();
    render(<MonthlyTopUpSection waqf={waqf} />);
    expect(await screen.findByText(/Next on 15 December 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Visa ending 4081/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop monthly top-up" }));
    await user.click(screen.getByRole("button", { name: "Yes, stop it" }));
    expect(await screen.findByLabelText("Monthly top-up amount")).toBeInTheDocument();
  });

  test("someone other than the primary contact is told who can change it", async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/waqfs/w1/monthly-top-up") return running;
      if (path === "/waqfs/w1/monthly-top-up/amount") throw new ApiError("Only the primary contact for this Foundation can do this.", 403);
      throw new Error(path);
    });
    const user = userEvent.setup();
    render(<MonthlyTopUpSection waqf={waqf} />);
    const input = await screen.findByLabelText("New monthly amount");
    await user.clear(input);
    await user.type(input, "300000");
    await user.click(screen.getByRole("button", { name: "Change amount" }));
    expect(await screen.findByText(/Only your Foundation's primary contact/)).toBeInTheDocument();
  });
});
