import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { SettingsService } from "../../common/settings/settings.service";

export interface Bank {
  name: string;
  code: string;
}

interface PaystackBank {
  name: string;
  code: string;
  active: boolean;
  country: string;
  currency: string;
}

interface PaystackListBanksResponse {
  status: boolean;
  data?: PaystackBank[];
  message?: string;
}

// Nigeria's bank list changes rarely (a new entrant, a merger) — caching
// it in memory for a day avoids hitting Paystack on every beneficiary
// form render, the same "known inefficiency, not a correctness bug"
// tradeoff PaystackPayoutAdapter's own comment already accepts for not
// caching recipient codes, just on the other side: here the data barely
// ever changes, so caching is the actually-correct default rather than
// premature. No cross-process cache (Redis, etc.) — this backend is a
// single Node process, and losing the cache on a redeploy just means
// one extra Paystack call, not a bug.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BanksService {
  private readonly baseUrl = "https://api.paystack.co";
  private cache: { banks: Bank[]; fetchedAt: number } | null = null;

  constructor(private readonly settings: SettingsService) {}

  async listNigerianBanks(): Promise<Bank[]> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.banks;
    }

    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!secretKey) {
      // Same posture as every other Paystack adapter's own missing-key
      // handling (see paystack.adapter.ts) — an operator configuration
      // gap, not a founder-facing bug, so a clear 503 rather than an
      // opaque 500.
      throw new ServiceUnavailableException("Bank lookup isn't available right now.");
    }

    const res = await fetch(`${this.baseUrl}/bank?country=nigeria&currency=NGN`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const body = (await res.json()) as PaystackListBanksResponse;
    if (!res.ok || !body.status || !body.data) {
      throw new Error(`Paystack list banks failed: ${body.message ?? res.statusText}`);
    }

    const banks = body.data
      .filter((bank) => bank.active && bank.currency === "NGN")
      .map((bank) => ({ name: bank.name, code: bank.code }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.cache = { banks, fetchedAt: Date.now() };
    return banks;
  }
}
