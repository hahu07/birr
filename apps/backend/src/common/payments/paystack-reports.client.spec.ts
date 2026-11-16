import { ServiceUnavailableException } from "@nestjs/common";
import { PaystackReportsClient } from "./paystack-reports.client";
import type { SettingsService } from "../settings/settings.service";

describe("PaystackReportsClient", () => {
  const realFetch = global.fetch;
  const withKey = { get: async () => "sk_test_fake" } as unknown as SettingsService;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function stubPages(pages: unknown[][]) {
    const urls: string[] = [];
    global.fetch = (async (url: string) => {
      urls.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ status: true, data: pages[page - 1] ?? [], meta: { pageCount: pages.length, page } }) } as Response;
    }) as typeof fetch;
    return urls;
  }

  test("reads every page of transactions for the window, mapping amounts and dates", async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: i, reference: `r${i}`, status: "success", amount: 100, currency: "ngn", created_at: "2026-11-15T10:00:00Z" }));
    const urls = stubPages([first, [{ id: 100, reference: "r100", status: "failed", amount: 5, currency: "NGN", created_at: "2026-11-15T11:00:00Z" }]]);
    const rows = await new PaystackReportsClient(withKey).transactions(new Date("2026-11-14T23:00:00Z"), new Date("2026-11-15T23:00:00Z"));
    expect(rows).toHaveLength(101);
    expect(rows[100]).toEqual({ id: 100, reference: "r100", status: "failed", amount: 5, currency: "NGN", createdAt: new Date("2026-11-15T11:00:00Z") });
    expect(urls[0]).toContain("https://api.paystack.co/transaction?perPage=100&page=1&from=2026-11-14T23%3A00%3A00.000Z");
    expect(urls).toHaveLength(2);
  });

  test("a refund names its payment by reference or by id, whichever Paystack gives", async () => {
    stubPages([[
      { transaction: { id: 9, reference: "P1" }, status: "processed", amount: 100, currency: "NGN", createdAt: "2026-11-15T10:00:00Z" },
      { transaction: 10, status: "pending", amount: 50, currency: "NGN", createdAt: "2026-11-15T10:00:00Z" },
    ]]);
    const rows = await new PaystackReportsClient(withKey).refunds(new Date(), new Date());
    expect(rows.map((r) => [r.transactionReference, r.transactionId])).toEqual([["P1", 9], [null, 10]]);
  });

  test("without a Paystack key it refuses instead of reporting an empty day", async () => {
    const noKey = { get: async () => undefined } as unknown as SettingsService;
    await expect(new PaystackReportsClient(noKey).transfers(new Date(), new Date())).rejects.toThrow(ServiceUnavailableException);
  });
});
