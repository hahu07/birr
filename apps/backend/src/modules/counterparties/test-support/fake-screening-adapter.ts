import { ScreenResult, ScreenSubjectInput, ScreeningProviderAdapter } from "../providers/screening-provider.interface";

/**
 * A fake ScreenShieldAdapter for specs that need CounterpartiesService/
 * SanctionsScreeningService wired up without making real HTTP calls —
 * same "fake adapter cast as the real class" pattern as
 * distributions/test-support/fake-payout-adapters.ts. `nextResult`
 * defaults to "clear" (the common case); set it per-test to drive a
 * "hit" or "error" scenario.
 */
export class FakeScreeningAdapter implements ScreeningProviderAdapter {
  calls: ScreenSubjectInput[] = [];
  nextResult: ScreenResult = { status: "clear", raw: { match: false } };

  async screen(input: ScreenSubjectInput): Promise<ScreenResult> {
    this.calls.push(input);
    return this.nextResult;
  }
}
