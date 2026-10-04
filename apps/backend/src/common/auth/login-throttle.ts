// Shared rate-limit policy for every login endpoint — FoundersController's
// and BirrStaffController's own `login`/`login/mfa` routes, four
// independent @nestjs/throttler buckets (one per route) all expressing
// the same policy. 10 requests per 10 minutes is the real production
// value; every one of those four @Throttle() decorators had it
// hardcoded individually before this existed.
//
// AUTH_LOGIN_THROTTLE_LIMIT overrides it, and exists for exactly one
// reason: the Playwright e2e suite (apps/web/e2e/*.spec.ts, run via
// apps/web/playwright.config.ts locally and the "e2e-test" job in
// .github/workflows/ci.yml) drives many real, independently-
// authenticated maker/checker staff and founder logins across its own
// spec files within a single run — a legitimate volume no real human,
// or attacker, would ever produce against this endpoint in 10 minutes,
// but one that started tripping the real limit as the suite grew (see
// that CI job's own comment on where this is actually set). Production
// never sets this env var, so `loginThrottleLimit()` always returns the
// real 10 there — this is test-environment headroom, not a weakened
// control.
export function loginThrottleLimit(): number {
  return Number(process.env.AUTH_LOGIN_THROTTLE_LIMIT) || 10;
}
