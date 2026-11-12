import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ZakahPaymentStatusPage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "p-1" }) }));
vi.mock("../../../../lib/api", () => ({ apiFetch: vi.fn(), apiFetchJson: vi.fn() }));

import { apiFetchJson } from "../../../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

function respondWith(status: string, feeCover = "0.00") {
  mockedApiFetchJson.mockResolvedValue({ id: "p-1", amount: "95000.00", feeCover, currency: "NGN", status });
}

describe("Zakah payment status page", () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
  });

  test("checks with Paystack first, then shows a confirmed payment", async () => {
    respondWith("confirmed", "1548.23");
    render(<ZakahPaymentStatusPage />);

    expect(await screen.findByText("Your zakah has been received")).toBeInTheDocument();
    expect(screen.getByText(/₦95,000.00 — Birr will pass it on/)).toBeInTheDocument();
    expect(screen.getByText(/covering the ₦1,548.23 processing fee/)).toBeInTheDocument();
    expect(mockedApiFetchJson.mock.calls[0]).toEqual(["/zakah-payments/p-1/verify", { method: "POST" }]);
  });

  test("tells the payer nothing was taken when the payment failed", async () => {
    respondWith("failed");
    render(<ZakahPaymentStatusPage />);
    expect(await screen.findByText("No zakah was taken. You can try again from the calculator.")).toBeInTheDocument();
  });

  test("waits while the payment is pending", async () => {
    respondWith("pending");
    render(<ZakahPaymentStatusPage />);
    expect(await screen.findByText("Waiting for your bank to confirm…")).toBeInTheDocument();
  });
});
