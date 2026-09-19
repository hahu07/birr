// Percentage points a fund's actual instrument-type allocation may
// diverge from its target before staff get notified. A single
// top-level constant, not a per-fund setting — "start simple," same
// posture as EXPIRY_WARNING_WINDOW_DAYS. 10pp is generous enough that
// routine month-to-month movement (a maturing tranche, a newly cleared
// Shariah screening moving pending money into active) doesn't trigger
// noise on its own, while still catching a fund that's genuinely
// drifted from its stated policy. Shared by both InvestmentTargetsService
// and VaultInvestmentTargetsService — unlike COMMITTED_INVESTMENT_STATUSES,
// this is a cross-cutting policy number, not a per-model business rule,
// so it lives in exactly one place.
export const PORTFOLIO_DRIFT_THRESHOLD_PERCENT = 10;
