import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PayZakahForm, type ZakahPaymentTerms } from "./PayZakahForm";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, apiFetch: vi.fn(), apiFetchJson: vi.fn() };
});

import { ApiError, apiFetchJson } from "../../../lib/api";

const mockedApiFetchJson = vi.mocked(apiFetchJson);

const terms: ZakahPaymentTerms = {
  available: true,
  currency: "NGN",
  minimumAmount: "100",
  wakalah: { version: "2026-11-11-draft", text: "I appoint Birr as my agent (wakil) to distribute my zakah." },
};

function setup() {
  const redirectTo = vi.fn();
  render(<PayZakahForm zakahDue="95000.00" ruleset={{ key: "maliki", version: 2 }} terms={terms} redirectTo={redirectTo} />);
  return { user: userEvent.setup(), redirectTo };
}

function sentBodies() {
  return mockedApiFetchJson.mock.calls.filter(([path]) => path === "/zakah-payments").map(([, init]) => JSON.parse(init!.body as string));
}

// These tests type whole amounts keystroke by keystroke, which can pass
// the 5s default on a busy machine.
describe("PayZakahForm", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockedApiFetchJson.mockReset();
    mockedApiFetchJson.mockResolvedValue({ payment: { id: "p-1" }, clientPayload: { checkoutUrl: "https://checkout.paystack.test/p-1" } });
  });

  test("can't pay until the payer accepts the agency wording", async () => {
    const { user } = setup();
    const pay = screen.getByRole("button", { name: "Pay ₦95,000.00" });
    expect(pay).toBeDisabled();
    await user.click(screen.getByLabelText(/I appoint Birr as my agent/));
    expect(pay).toBeEnabled();
  });

  test("sends the amount, fee choice, accepted wording and ruleset, then goes to Paystack", async () => {
    const { user, redirectTo } = setup();
    await user.click(screen.getByLabelText(/Add ₦1,548.23 to cover the processing fee/));
    await user.type(screen.getByLabelText(/Email for your receipt/), "amina@example.com");
    await user.click(screen.getByLabelText(/I appoint Birr as my agent/));
    await user.click(screen.getByRole("button", { name: "Pay ₦96,548.23" }));

    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://checkout.paystack.test/p-1"));
    expect(sentBodies()).toEqual([
      {
        amount: "95000.00",
        coverFee: true,
        wakalahConsentVersion: "2026-11-11-draft",
        payerEmail: "amina@example.com",
        rulesetKey: "maliki",
        rulesetVersion: 2,
      },
    ]);
  });

  test("lets the payer pay part of it, with commas", async () => {
    const { user } = setup();
    const amount = screen.getByLabelText("Amount to pay");
    await user.clear(amount);
    await user.type(amount, "50,000");
    await user.click(screen.getByLabelText(/I appoint Birr as my agent/));
    await user.click(screen.getByRole("button", { name: "Pay ₦50,000.00" }));

    await waitFor(() => expect(sentBodies()).toHaveLength(1));
    expect(sentBodies()[0]).toMatchObject({ amount: "50000", coverFee: false });
  });

  test("refuses an amount below the minimum", async () => {
    const { user } = setup();
    const amount = screen.getByLabelText("Amount to pay");
    await user.clear(amount);
    await user.type(amount, "50");
    expect(screen.getByText("Enter at least ₦100, like 95000.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
  });

  test("asks for name and ID when the backend requires identity, and sends them on retry", async () => {
    mockedApiFetchJson.mockRejectedValueOnce(new ApiError("We're required to confirm your identity.", 400, "IDENTITY_REQUIRED"));
    const { user, redirectTo } = setup();
    await user.click(screen.getByLabelText(/I appoint Birr as my agent/));
    await user.click(screen.getByRole("button", { name: "Pay ₦95,000.00" }));

    expect(await screen.findByText("We're required to confirm your identity.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Full name"), "Amina Bello");
    await user.type(screen.getByLabelText("ID number"), "12345678901");
    await user.click(screen.getByRole("button", { name: "Pay ₦95,000.00" }));

    await waitFor(() => expect(redirectTo).toHaveBeenCalled());
    expect(sentBodies()[1]).toMatchObject({ payerFullName: "Amina Bello", idType: "national_id", idNumber: "12345678901" });
  });

  test("monthly zakah is paid in advance, needs an email, and says so before paying", async () => {
    const { user, redirectTo } = setup();
    await user.click(screen.getByLabelText(/Pay this every month, in advance/));
    expect(screen.getByText(/paid ahead of when it falls due/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Email/ })).toBeRequired();
    await user.type(screen.getByRole("textbox", { name: /^Email/ }), "yusuf@example.com");
    await user.click(screen.getByLabelText(/I appoint Birr as my agent/));
    await user.click(screen.getByRole("button", { name: "Pay ₦95,000.00 now, then monthly" }));
    await waitFor(() => expect(redirectTo).toHaveBeenCalled());
    expect(sentBodies()[0]).toMatchObject({ amount: "95000.00", payerEmail: "yusuf@example.com", monthly: true });
  });

  test("a receipt by WhatsApp: the number is confirmed with a code first, and only then can the payer pay", async () => {
    mockedApiFetchJson.mockImplementation(async (path: string) => {
      if (path === "/giving/whatsapp/code") return { sent: true, number: "+2348031234567" };
      if (path === "/giving/whatsapp/confirm") return { whatsapp: "+2348031234567", proof: "proof-123" };
      return { payment: { id: "p-1" }, clientPayload: { checkoutUrl: "https://checkout.paystack.test/p-1" } };
    });
    const { user, redirectTo } = setup();
    await user.click(screen.getByRole("radio", { name: "WhatsApp" }));
    expect(screen.queryByRole("textbox", { name: /^Email/ })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/I appoint Birr as my agent/));
    const pay = screen.getByRole("button", { name: "Pay ₦95,000.00" });
    // A chosen WhatsApp number has to be confirmed before paying.
    expect(pay).toBeDisabled();

    await user.type(screen.getByLabelText("WhatsApp number"), "0803 123 4567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/Enter the code we sent by WhatsApp/)).toBeInTheDocument();
    await user.click(screen.getByLabelText("Digit 1"));
    await user.paste("123456");
    expect(await screen.findByText(/WhatsApp \+234 803 ••• 4567 confirmed/)).toBeInTheDocument();
    expect(mockedApiFetchJson).toHaveBeenCalledWith("/giving/whatsapp/confirm", { method: "POST", body: JSON.stringify({ whatsapp: "+2348031234567", code: "123456" }) });

    await user.click(pay);
    await waitFor(() => expect(redirectTo).toHaveBeenCalled());
    const body = sentBodies()[0];
    expect(body).toMatchObject({ payerWhatsApp: "+2348031234567", whatsappProof: "proof-123" });
    expect(body.payerEmail).toBeUndefined();
  });

  test("Zakah al-Fitr has no monthly option", () => {
    render(<PayZakahForm zakahDue="7500" ruleset={null} terms={terms} fitr={{ people: 3, form: "food" }} redirectTo={vi.fn()} />);
    expect(screen.queryByLabelText(/Pay this every month/)).not.toBeInTheDocument();
  });
});
