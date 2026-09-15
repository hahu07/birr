import { Injectable } from "@nestjs/common";
import { ScreenResult, ScreenSubjectInput, ScreeningProviderAdapter } from "./screening-provider.interface";
import { SettingsService } from "../../../common/settings/settings.service";

// PLACEHOLDER SHAPE — no real ScreenShield API docs or sandbox access
// exist yet (CLAUDE.md's own dated note: "before any commercial
// commitment, Birr's own leadership still needs to independently
// verify ScreenShield's claims... none of that can be substituted for
// by picking a vendor from its own marketing site"). This is a
// conventional REST KYC/AML vendor shape (bearer API key, POST a
// name/country, get a match/no-match JSON back) chosen so this adapter
// is easy to correct once real docs exist — nothing about the request/
// response parsing below should be trusted as verified against
// ScreenShield's actual API. Both API_KEY and BASE_URL are stored as
// ProviderCredential rows (see provider-fields.ts) specifically so
// pointing this at the real endpoint never needs a code change.
interface ScreenShieldResponse {
  match: boolean;
  matches?: unknown;
}

@Injectable()
export class ScreenShieldAdapter implements ScreeningProviderAdapter {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Never throws — every failure mode (vendor unconfigured, network
   * error, non-2xx response, unparseable body) resolves to
   * `{status: "error", ...}` instead, so SanctionsScreeningService
   * always has a result to persist and CounterpartiesService.register()
   * never has its own transaction aborted by a screening-infra problem.
   * See ScreenResult's own comment on why "error" still blocks
   * onboarding exactly like a real hit — this is fail-closed, not a
   * silent skip.
   */
  async screen(input: ScreenSubjectInput): Promise<ScreenResult> {
    const apiKey = await this.settings.get("screenshield", "API_KEY");
    const baseUrl = await this.settings.get("screenshield", "BASE_URL");
    if (!apiKey || !baseUrl) {
      return { status: "error", raw: null, errorMessage: "ScreenShield isn't configured (missing API key or base URL)." };
    }

    try {
      const res = await fetch(`${baseUrl}/screen`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name, country: input.country }),
      });
      if (!res.ok) {
        return { status: "error", raw: { httpStatus: res.status }, errorMessage: `ScreenShield returned HTTP ${res.status}.` };
      }
      const body = (await res.json()) as ScreenShieldResponse;
      return body.match ? { status: "hit", raw: body } : { status: "clear", raw: body };
    } catch (err) {
      return {
        status: "error",
        raw: null,
        errorMessage: err instanceof Error ? err.message : "Unknown error calling ScreenShield.",
      };
    }
  }
}
