import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManageMonthlyGiftPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ token: "tok-1" }) }));
vi.mock("../../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

import { ApiError, apiFetchJson } from "../../../../../lib/api";

const mockedFetch = vi.mocked(apiFetchJson);

function gift(over: Record<string, unknown> = {}) {
  return {
    kind: "vault",
    status: "active",
    pauseReason: null,
    email: "amina@example.com",
    amount: "250000",
    currency: "NGN",
    dayOfMonth: 15,
    nextChargeAt: "2026-12-15T08:00:00.000Z",
    card: { last4: "4081", brand: "visa", expMonth: 12, expYear: 2030 },
    cardUpdateInProgress: false,
    target: { name: "Ramadan Relief", detail: "Water Wells", link: "/vaults/ramadan-relief" },
    minimumAmount: "250000",
    charges: [{ id: "c1", period: "2026-11", amount: "250000", status: "confirmed", date: "2026-11-15T08:00:00.000Z" }],
    cancelledAt: null,
    endedReason: null,
    ...over,
  };
}

describe("Manage a monthly gift", { timeout: 20_000 }, () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
  });

  test("shows the gift, the next charge, the card's last four digits and the history", async () => {
    mockedFetch.mockResolvedValue(gift());
    render(<ManageMonthlyGiftPage />);
    expect(await screen.findByText("Ramadan Relief")).toBeInTheDocument();
    expect(screen.getByText("15 December 2026")).toBeInTheDocument();
    expect(screen.getByText(/ending 4081/)).toBeInTheDocument();
    expect(screen.getByText("November 2026")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  test("changing the amount posts it; cancelling asks first", async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/giving/manage/tok-1/amount") return gift({ amount: "300000" });
      if (path === "/giving/manage/tok-1/cancel") return gift({ status: "cancelled", cancelledAt: "2026-11-20T10:00:00.000Z" });
      return gift();
    });
    const user = userEvent.setup();
    render(<ManageMonthlyGiftPage />);

    const amount = await screen.findByLabelText("Monthly amount");
    await user.clear(amount);
    await user.type(amount, "300000");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    const [, init] = mockedFetch.mock.calls.find(([path]) => path === "/giving/manage/tok-1/amount")!;
    expect(JSON.parse(init!.body as string)).toEqual({ amount: "300000" });

    await user.click(screen.getByRole("button", { name: "Cancel monthly gift" }));
    expect(mockedFetch.mock.calls.some(([path]) => path === "/giving/manage/tok-1/cancel")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(await screen.findByText(/No further payments will be taken. Thank you/)).toBeInTheDocument();
  });

  test("a failed card offers a card update that goes to checkout", async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/giving/manage/tok-1/card") return { checkoutUrl: "https://checkout.test/card" };
      return gift({ status: "paused", pauseReason: "card_failed", nextChargeAt: null });
    });
    const user = userEvent.setup();
    render(<ManageMonthlyGiftPage />);
    expect(await screen.findByText("We couldn't charge your card")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update card" }));
    await waitFor(() => expect(window.location.href).toBe("https://checkout.test/card"));
  });

  test("a gift paused for ID asks for it and resumes", async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/giving/manage/tok-1/identity") return gift();
      return gift({ status: "paused", pauseReason: "needs_identity", nextChargeAt: null });
    });
    const user = userEvent.setup();
    render(<ManageMonthlyGiftPage />);
    await user.type(await screen.findByLabelText("Full name"), "Amina Bello");
    await user.type(screen.getByLabelText("ID number"), "12345678901");
    await user.click(screen.getByRole("button", { name: "Save and carry on" }));
    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());
    const [, init] = mockedFetch.mock.calls.find(([path]) => path === "/giving/manage/tok-1/identity")!;
    expect(JSON.parse(init!.body as string)).toEqual({ fullName: "Amina Bello", idType: "national_id", idNumber: "12345678901" });
  });

  test("an old or wrong link says so and offers new links", async () => {
    mockedFetch.mockRejectedValue(new ApiError("This link isn't valid.", 404));
    render(<ManageMonthlyGiftPage />);
    expect(await screen.findByText("This link isn't valid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Email me my links/ })).toHaveAttribute("href", "/giving/manage");
  });

  test("monthly zakah paused for new terms shows the new wording and resumes once accepted", async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === "/zakah-payments/terms") return { wakalah: { version: "v-new", text: "I appoint Birr as my agent (new wording)." } };
      if (path === "/giving/manage/tok-1/terms") return gift({ kind: "zakah", target: { name: "Zakah on wealth", detail: "paid in advance" } });
      return gift({ kind: "zakah", status: "paused", pauseReason: "terms_changed", nextChargeAt: null, target: { name: "Zakah on wealth", detail: "paid in advance" } });
    });
    const user = userEvent.setup();
    render(<ManageMonthlyGiftPage />);
    const accept = await screen.findByRole("button", { name: "Accept and carry on" });
    expect(accept).toBeDisabled();
    await user.click(await screen.findByLabelText(/new wording/));
    await user.click(accept);
    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());
    const [, init] = mockedFetch.mock.calls.find(([path]) => path === "/giving/manage/tok-1/terms")!;
    expect(JSON.parse(init!.body as string)).toEqual({ version: "v-new" });
  });
});
