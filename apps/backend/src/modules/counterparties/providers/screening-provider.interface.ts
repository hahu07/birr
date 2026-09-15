export interface ScreenSubjectInput {
  name: string;
  country?: string;
}

/**
 * "error" is a real, distinct outcome from "clear" — see
 * SanctionsScreeningStatus's own schema comment on why
 * CounterpartiesService.onboard() treats the two completely
 * differently (fail-closed: an error blocks onboarding exactly like a
 * real hit does, since screening never actually ran either way).
 * `raw`/`errorMessage` are what SanctionsScreeningService persists
 * onto the SanctionsScreening row for whoever resolves it to see.
 */
export type ScreenResult =
  | { status: "clear"; raw: unknown }
  | { status: "hit"; raw: unknown }
  | { status: "error"; raw: unknown; errorMessage: string };

export interface ScreeningProviderAdapter {
  screen(input: ScreenSubjectInput): Promise<ScreenResult>;
}
