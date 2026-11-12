import type { SettingsService } from "../../common/settings/settings.service";
import * as devFallback from "../../common/email/dev-send-fallback";
import { ResendZakahReceiptEmailAdapter } from "./zakah-receipt-email.adapter";

// Outside a real deployment with no Resend key, the adapter logs what it
// would have sent — which lets this check the wording without sending mail.
describe("ResendZakahReceiptEmailAdapter.sendRefundNotice", () => {
  const adapter = new ResendZakahReceiptEmailAdapter({ get: async () => undefined } as unknown as SettingsService);
  const notice = { to: "amina@example.com", amount: "95000", paymentDate: "2027-02-10", accountLast4: "6789", refundId: "rf-1" };
  let logged: { kind: string; to: string; body: string }[];

  beforeEach(() => {
    logged = [];
    jest.spyOn(devFallback, "logDevEmailFallback").mockImplementation((kind, to, body) => void logged.push({ kind, to, body }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("approved: the amount, the account it's going to, and that another email follows", async () => {
    await adapter.sendRefundNotice({ ...notice, stage: "approved" });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ kind: "zakah refund approved", to: "amina@example.com" });
    expect(logged[0].body).toContain("₦95,000.00");
    expect(logged[0].body).toContain("account ending 6789");
    expect(logged[0].body).toContain("email you again once it's sent");
  });

  test("paid: the date and the bank's reference, as the payer's record", async () => {
    await adapter.sendRefundNotice({ ...notice, stage: "paid", paidOn: "2027-02-14", bankReference: "NIP-000123" });
    expect(logged[0].kind).toBe("zakah refund paid");
    expect(logged[0].body).toContain("on 2027-02-14");
    expect(logged[0].body).toContain("Bank reference: NIP-000123");
    expect(logged[0].body).toContain("Keep this email as your record");
  });
});
