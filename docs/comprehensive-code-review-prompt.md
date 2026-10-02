# Comprehensive Code Review Prompt

A standing prompt for a thorough, whole-codebase review of Birr — not a
diff review of one change, but a periodic sweep across everything, the
way you'd audit a fiduciary system before it handles real money. Paste
the prompt below into a fresh session (or hand it to a review agent) to
run it. Update this doc as new non-negotiables, known trouble patterns,
or architectural conventions get established — it should stay current,
not freeze at whatever the codebase looked like when first written.

## How to use this

- **Fresh context matters.** Run this from a new session, not one
  carrying assumptions from recent feature work — the point is an
  outside, skeptical pass, not confirming what you already believe is
  true.
- **Read code, don't recall it.** Every claim below ("X is enforced by
  Y") must be verified against the actual current file, not assumed
  from a comment or from what a past session concluded. Comments and
  even this doc can drift from the code.
- **Report findings ranked by severity**, most serious first, each with
  a concrete failure scenario (specific input/state → specific wrong
  outcome), not a vague "this could be an issue." A finding without a
  reproducible scenario is a hunch, not a finding — verify it or drop
  it.
- Scope is the whole repo unless the user narrows it. If time is
  limited, prioritize in this order: (1) anything touching money or
  approvals, (2) the non-negotiables checklist, (3) known trouble
  patterns, (4) frontend correctness, (5) everything else.
- **§9 (deliberate decisions) is not optional reading.** This codebase
  has many decisions that look like defects without their history.
  Flagging one as a bug wastes the review's credibility.

---

## The prompt

```
Perform a comprehensive, careful review of the Birr codebase
(/home/mutalab/Projects/birr) — a fiduciary Islamic waqf trustee
platform. Read CLAUDE.md in full first; it defines the non-negotiables
this review checks against, and records the reasoning behind decisions
that look odd without it. This is a whole-codebase audit, not a diff
review — read the actual current source for every claim you make, do
not rely on comments, memory, or prior session summaries.

Work through each section below. For every item, find the actual code
that should enforce it, confirm it does, and try to construct a
concrete counterexample (a specific input, actor, or state) that would
break it. Report findings ranked by severity, each with the exact
file/line and a concrete failure scenario — not a general concern.

### 0. Orientation

Two products share one trustee engine (see CLAUDE.md's "Two products,
one trustee"):
- **Waqf Funds** — a Founder self-service establishes a Foundation and
  Waqf Fund(s); Birr staff then govern them through `governed_actions`.
- **Vault** — Birr-staff-curated public giving campaigns; no Founder,
  no account, no deed. Reuses the same `governed_actions` engine,
  payment adapters, `CauseCategory` catalog and `Counterparty` registry.

Layout:
- `apps/backend` — NestJS. 43 modules under `src/modules/`, shared
  concerns under `src/common/` (auth, db, guards, money, payments,
  storage, validation, whatsapp, settings, files, email, notifications).
- `apps/web` — one Next.js App Router deployment, two route groups:
  `app/(founder)` (public + Founder, lower trust) and `app/ops`
  (Birr staff, higher privilege). Shared UI in `packages/ui`.
- `packages/db` — Prisma schema, migrations, seed data.
- `services/agents` — Claude Agent SDK agents (rasid, nazim, kashif,
  rashid, rafiq, munsif, bashir).

Running things:
- Backend tests: `cd apps/backend && npx jest src/modules/<module>`
  (93 spec files; the full suite is slow — scope it).
- Frontend tests: `pnpm --filter @birr/web test` (vitest).
- Typecheck: `npx tsc --noEmit -p tsconfig.json` in each app.
- Lint: `pnpm --filter @birr/web lint`.
- Postgres is local on port 5433; `DATABASE_URL` is in `.env`.
- The web dev server reads `NEXT_PUBLIC_BACKEND_URL` at process start.
  If it is unset the client builds request URLs as `undefined/...`,
  which 404 and render as *plausible empty states*, not errors — verify
  which backend a running frontend is actually talking to before
  concluding anything about runtime behavior.

### 1. Non-negotiables (CLAUDE.md), made concrete

- **Immutable audit trail**: for every model CLAUDE.md lists as
  governed (Founder, Waqf, Asset, Beneficiary, Distribution,
  Investment) and every model added since (the whole Vault family
  included), confirm every create/update/delete path writes a matching
  `audit_logs` row with actor, actor type, before/after snapshot. Grep
  every `.service.ts` for a Prisma write with no adjacent
  `auditLog.create` in the same transaction. Confirm `audit_logs` truly
  has UPDATE/DELETE revoked at the DB role level (not just app-layer
  convention) — try it directly against the database, don't just read a
  migration file and assume it applied cleanly.
- **Audit hash chain**: `audit_logs` carries `sequence`,
  `previousHash`, `recordHash`, filled by a BEFORE INSERT trigger, not
  by application code. Confirm the trigger still exists and still fires,
  that no application code sets those fields, and that the chain
  actually verifies end-to-end over current data (recompute it). A
  chain that silently stopped matching is worse than no chain.
- **Maker-checker at the individual level**: for every
  `governed_actions` permission with `requiresMakerChecker: true`,
  confirm the DB has a real CHECK constraint rejecting
  `checker_user_id = maker_user_id` — read the actual constraint SQL,
  then run a test that attempts it and confirms the database itself
  rejects it, not just `GovernedActionsService`. Flag any governed-action
  handler reachable without going through `governed_actions` at all (a
  controller route that mutates a governed field directly).
- **Founder/waqf isolation**: for every founder-facing read/write,
  confirm it's scoped via `withFounderScope`
  (`common/db/founder-scope.ts` — both the RLS session variable and the
  app-layer WHERE clause) or an equivalent explicit ownership check —
  not an app-layer WHERE alone, which regresses silently if the RLS
  policy is ever misconfigured. Confirm no founder-facing route can
  enumerate or act on another Founder's data by guessing an ID (test
  with a real second Founder fixture). Note Vault has no Founder to
  isolate from — a published Vault is public by design.
- **AI advisory-only**: confirm the `governed_actions` schema still has
  no `checker_agent_id` column, and that every `ai_agents`-authenticated
  route (`x-agent-api-key`) only ever writes drafts/proposals, never a
  `decide()`/approval path. Confirm each agent's tool allow-list in
  `services/agents/src/agents/` contains no "approve" tool.
- **Segregation of duties**: confirm `birr_staff` roles are modeled as
  a real enum/table, not a flag, and that role-permission seed data
  (`packages/db/prisma/seed-data.ts`) never gives one role both maker
  and checker rights on the same permission. Flag any code path where a
  single person could plausibly both propose and approve an action
  across two roles they happen to hold simultaneously.
- **Conflict-of-interest declarations**: confirm these are structured
  fields (`conflict_of_interest_declarations`), not a free-text blob
  bolted onto another table.

### 2. Money correctness (highest-value section — start here)

- **Allocation ceilings**: `common/money/allocation-ceiling.ts`'s
  `assertWithinAllocation` is the gate that stops staff moving more to a
  cause than was allocated to it. Confirm it is enforced at BOTH
  distribution creation and governed-action approval (a check at
  creation alone is bypassable by an approval that lands later), and
  that each currency's ceiling is enforced independently — committing
  against one currency must never consume another's headroom.
- **Investment-type corpus is not distributable** (CLAUDE.md,
  2026-09-04): for an Investment-type waqf/vault, the ceiling is
  `proceedsAllocatedAmount` ALONE; `allocatedAmount` (corpus) must not
  count toward what a distribution can draw. Asset/Project types have no
  proceeds concept and use `allocatedAmount` as their only, fully
  distributable pool. Confirm the type branch is real and correct in
  both the Waqf and Vault paths.
- **What counts as raised**: `SPENDABLE_CONTRIBUTION_WHERE`
  (`modules/vaults/spendable-contributions.ts`) is the single definition
  — confirmed, not held, not refunded. Grep every aggregate over
  contributions and confirm none hand-rolls its own filter. A past bug
  counted refunded and held gifts as raised.
- **Never blend currencies**: confirm every monetary aggregate
  (`withAmountRaised`, `spentByCurrency`, `sumForVault`,
  `platformSummary`, `founderSummary`, financial reports, impact
  summaries) groups by currency and never sums or converts across it.
  Grep for any `_sum`/reduce over an `amount` that doesn't also group or
  filter by `currency`. There is deliberately no FX feed in this system.
- **Negative and zero amounts**: confirm every money-accepting DTO uses
  `IsPositiveDecimal` (`common/validation/positive-decimal.ts`). A past
  bug allowed negative distribution amounts. Check refunds, expenses,
  proceeds, allocations, targets and contributions alike.
- **Decimal discipline**: confirm money is Prisma `Decimal`/string end
  to end and never passes through JS `number` for arithmetic that
  persists. Flag any `Number(...)` on a money field feeding a write
  (display-only conversion is fine).
- **Double-entry ledger**: for `VaultLedgerService`/`WaqfLedgerService`,
  confirm every posting balances (debits == credits) and that the
  auto-posting hooks (confirmed contribution, paid distribution,
  recorded expense) can't double-post on retry/webhook replay.

### 3. Vault-specific (public-giving surface, no account)

- **Public payload whitelists**: `VaultsService.PUBLIC_VAULT_SELECT` is
  a field allowlist for the two `@Public()` routes. Confirm it still
  excludes `VaultCauseAllocation` ceilings (governed internal figures),
  `createdByUserId`, and every `CauseCategory` field except `icon`.
  Confirm no later `include`/spread reintroduces a staff-only field. A
  past bug leaked `heldReason` and donor IP through a public endpoint.
- **AML / anti-structuring**: `VaultContributionsService
  .findOrCreateDonor` enforces `VaultDonorThreshold` ID capture.
  Confirm the threshold check accumulates across currencies (comparing
  each on its own terms, never converting), and that
  `getStructuringReview` groups correctly. Note the single-`donorEmail`
  identity gap is an accepted v1 risk (§9) — do not re-report it as a
  defect; DO report any new way to evade the check that isn't that one.
- **Refunds/holds**: confirm the refund state machine
  (`VaultRefundStatus`) can't be driven into an inconsistent state by
  concurrent webhooks, and that a held or refunded contribution is
  excluded from every raised/spendable figure (§2).
- **Governed Vault actions**: Vault's own six governed actions
  (publishing, cause allocation, proceeds allocation, investment
  change, distribution approval, contribution refund) must go through
  the SAME `governed_actions` table and DB constraint as the Waqf side
  — confirm no second, parallel approval path was introduced for Vault.
- **Milestone-gated tranches**: confirm a distribution tied to a
  `VaultMilestone` is genuinely refused unless that milestone is
  `completed` — at the service layer, not only in the UI.

### 4. Backend security and auth

- **Guard coverage and order**: confirm `SessionAuthGuard` /
  `PermissionGuard` / `StaffRoleGuard` (`common/guards/`) actually run
  on every non-`@Public()` route — spot-check a sample rather than
  trusting the global `APP_GUARD` registration, and confirm provider
  order in `app.module.ts` still puts `SessionAuthGuard` first, since
  NestJS guard order matters.
- **MFA enforcement**: `resolveBirrStaffFromSession` /
  `isBirrStaffSession` / `@CurrentBirrStaff()`
  (`common/auth/current-birr-staff.ts`) enforce mandatory staff MFA
  themselves. This exists because a past bug let ~20 routes on
  class-level `@Public()` controllers resolve a staff caller in the
  handler with no guard to enforce MFA. Confirm every staff-resolving
  path still goes through those helpers, and that `@MfaExempt` is only
  on routes that genuinely must predate MFA (login, MFA setup).
- **Session separation**: founder and staff sessions use distinct
  httpOnly cookies (`birr_session` / `birr_staff_session`) so both can
  coexist in one browser. Confirm no route accepts the wrong cookie
  type, and that MFA-pending tokens (`purpose: "mfa_pending"`) can
  never be accepted as a real session.
- **Webhook signature verification**: confirm every payment-provider
  webhook recomputes and compares a signature over the *raw* body (not
  a re-serialized one) using `timingSafeEqual`, not `===`, and that
  `main.ts`'s raw-body carve-out list is in sync with every actual
  webhook route.
- **File upload validation**: confirm every upload path (logos, cover
  images, message attachments, milestone evidence, impact photos,
  blog images) validates mimetype against an explicit allowlist,
  enforces a real size cap, and never accepts `image/svg+xml` or
  another script-capable format.
- **Secrets hygiene**: confirm no encrypted field's plaintext (bank
  details, provider credentials) ever reaches an `audit_logs` snapshot,
  a log line, or a frontend response outside its owning session type.
- **RLS as defense-in-depth**: for any table with an RLS policy,
  confirm the app-layer WHERE clause was never removed on the
  assumption "RLS covers it" — both should independently hold.

### 5. Architectural consistency (backend)

- **Dual-session controller pattern**: every controller reachable by
  both a Founder and Birr-staff session should follow the same shape
  (`@Public()` at class level, a manual `isBirrStaffSession(request)`
  branch, `resolveFounderFromSession` for the founder path). Flag any
  controller that reinvents this differently — a subtly different auth
  check is where isolation bugs hide.
- **Soft-delete discipline**: confirm every model that is
  soft-delete-only is never hard-deleted from application code (a raw
  `deleteMany` reachable from a real route, not a maintenance script),
  and that every read path filters `deletedAt: null`. A missing filter
  on a list endpoint silently resurrects retired rows.
- **N+1 and aggregate batching**: list endpoints that decorate rows
  with aggregates (`withAmountRaised`, `withCauseAmountRaised`,
  `spentByCurrency`) must batch into one grouped query, not one per
  row. Flag any per-row `await` inside a `.map` over a list response.
- **PII boundary**: confirm beneficiary names/contact/bank details
  never appear in a response reachable by a Founder session — check
  every place `includeBeneficiaryNames` (or equivalent) defaults true,
  and confirm no founder-reachable route passes `true`.

### 6. Frontend (apps/web)

Read `apps/web/AGENTS.md` first: this Next.js version has breaking
changes from what you may expect, and the relevant guides live in
`node_modules/next/dist/docs/`. Do not assume App Router APIs from
training data.

- **Route-group boundary**: `app/(founder)` and `app/ops` each have
  their own layout and session provider (`lib/founder-session.tsx` /
  `lib/staff-session.tsx`) and deliberately share no client state.
  Confirm no module imports across the boundary, and that no
  staff-only component or type is reachable from a founder/public page
  bundle. Note: `/ops/sign-in` being unlinked is obscurity, NOT a
  security boundary — the real boundary is the backend guards. Flag any
  code or comment that treats unlinkedness as access control.
- **Public (no-session) surfaces**: `/`, `/vaults`, `/vaults/[slug]`,
  `/blog`, `/impact`. Confirm each renders fully without a session,
  never calls a session-requiring route in its main path, and never
  renders a field the backend's public allowlist excludes (cross-check
  against `PUBLIC_VAULT_SELECT`, §3). A field present in
  `lib/types.ts` but excluded from the backend allowlist is a type lie
  waiting to render `undefined`.
- **Failed fetch vs. empty state**: this is a real, recurring hazard —
  a 404/network failure that renders as "No vaults are open for giving
  right now" is indistinguishable from a true empty result. Audit every
  list/detail fetch for distinct loading / error / empty states, and
  flag any that collapses an error into an empty state. (`lib/api.ts`'s
  `apiFetchJson` and `ApiError` are the shared primitives.)
- **Type drift**: `lib/types.ts` (founder/public) and `lib/ops-types.ts`
  (staff) hand-duplicate many shapes. Diff them against each other AND
  against what the backend actually returns — a shape that exists in
  one but not the other, or has drifted in field names/optionality, is
  a structural risk of this duplication, not hypothetical. Pay
  attention to fields marked optional in the type but always present in
  practice (or vice versa).
- **Money in the UI**: confirm currencies are never summed or blended
  for display, that every progress bar has an honest denominator (a
  real target, not a ceiling or an unrelated figure), that percentages
  are clamped (`Math.min(100, ...)`), and that every displayed number
  is explicitly rounded/formatted rather than leaking float artifacts.
  Confirm a vault's additional currencies are shown on their own line,
  never folded into the primary-currency goal.
- **Copy accuracy**: fiduciary copy must match actual system behavior.
  Specifically re-check that Investment-type funds/vaults never
  describe corpus allocation as "what reaches your cause's
  beneficiaries" (only proceeds do — see CLAUDE.md 2026-09-04), and
  that nothing in marketing or product copy claims a licence,
  guarantee, return, or regulatory status Birr does not hold.
- **Governed-action affordances**: staff UI must propose, never
  self-approve. Confirm every propose control lands in a pending state
  and that no UI path lets the same person approve what they proposed
  (the DB will reject it — the UI should never offer it). Confirm no
  Founder-facing surface implies a Founder can approve a governed
  action.
- **Accessibility**: every input has a real label (or
  fieldset/legend for radio/checkbox groups); decorative icons and
  emoji carry `aria-hidden`; interactive elements are reachable and
  visible on keyboard focus; color is never the sole carrier of
  meaning; text on tinted backgrounds meets contrast. Check the
  donation flow and the Ops approval queue specifically — those are the
  two highest-consequence flows.
- **Responsive**: no horizontal overflow at 375px on any public page;
  wide tables/diagrams scroll inside their own container. The Ops
  Console's dense tables are the likely offenders.
- **Client-side safety**: no tokens or PII in `localStorage`
  (sessions are httpOnly cookies by design); no secret in a
  `NEXT_PUBLIC_*` var; no `dangerouslySetInnerHTML` over
  server-supplied or user-supplied content without sanitization (check
  the blog/markdown rendering path specifically).
- **Soft-deleted data**: confirm no UI renders rows the backend
  soft-deleted, including cached/stale client state after a delete.

### 7. Agents (services/agents)

- Confirm each agent's tool allow-list grants only what its tier
  permits, and that no agent has an approve/decide tool (§1).
- Confirm every agent-initiated write is attributable to a specific
  `ai_agents` row (`actorAgentId`), never an undifferentiated "the AI".
- Confirm Bashir (marketing) never auto-publishes, and that any claim
  about licensing/returns/guarantees/compliance in its output path
  requires Legal/Compliance sign-off specifically — not any staff
  member.

### 8. Known trouble patterns (found before — check they haven't
regressed or recurred elsewhere)

- **Missing `checkDuplicate` on governed-action handlers**: a prior bug
  let the same still-pending target be proposed twice (a page reload
  resets local "already proposed" UI state, but nothing server-side
  blocked a second identical proposal). Confirm every handler in
  `GovernedActionsService`'s handler map implements `checkDuplicate`.
- **Test fixtures leaking into globally-visible tables**: a prior bug
  had a spec create real `CauseCategory` rows (a table end users see)
  with no cleanup, permanently polluting shared dev-database catalog
  data. Separately, interrupted runs have left fixture `Vault` rows
  visible on the public `/vaults` page. Grep every `*.spec.ts` for
  `prisma.<model>.create` where `<model>` is globally visible
  (categories, policy sets, jurisdictions, vaults — anything not scoped
  to a fixture-only Foundation/Waqf/Founder) and confirm matching
  cleanup exists, FK-safe in order.
- **Notification read-state gaps**: a prior bug let a notification's
  target content be viewed through its own page without marking
  `Notification.readAt`, so an unread badge could stick permanently.
  For every notification type in `CHANNEL_PLAN`
  (`modules/notifications/notifications.service.ts`), confirm a real
  path beyond the bell marks it read.
- **Refunds/holds counted as raised** — see §2.
- **MFA bypass on class-level `@Public()` controllers** — see §4.
- **Public endpoint leaking `heldReason`/IP** — see §3.
- **Negative distribution amounts** — see §2.
- **Stale prebuilt backend shadowing the dev server**: not a code bug,
  but has repeatedly cost real debugging time. `nest start --watch`
  spawns a `node dist/main` child, so seeing `dist/main` in `ps` does
  NOT by itself mean the process is stale — check the parent and the
  child's start time against the last relevant source change before
  concluding anything about runtime behavior.

### 9. Deliberate decisions — do NOT report these as defects

Each of these looks like a bug without its history. All are recorded in
CLAUDE.md with the reasoning and the date the owner decided them. If you
believe one is now wrong, say so explicitly as a *reconsideration with
new evidence*, not as a newly discovered defect.

- **Stripe adapter exists but is unreachable from the UI**: Stripe does
  not support Nigeria at all. The adapter is kept deliberately (it would
  become real under a different legal entity); "Card (international)"
  was removed from both donation entry points on purpose.
- **USD/EUR/GBP funds have no working donation rail**: a known,
  unresolved consequence of the above. Flag new instances, not the
  known state.
- **No sanctions/PEP screening anywhere**: the ScreenShield
  Counterparty integration was built, proven working, then reverted
  before launch on the owner's instruction. Founder-establishment and
  Vault-donor screening were each designed and explicitly rejected:
  **no Founder self-service action and no donor contribution may ever
  be gated on an automated screening result.** Proposing such a gate is
  a standing violation, not an improvement.
- **Vault AML can be evaded with different emails**: accepted residual
  v1 risk, mitigated by off-platform manual review. Do not re-report.
- **Cause allocation is Founder self-service**, not maker-checker,
  even though it bounds what distributions can draw. Enforced as a real
  ceiling downstream instead.
- **`WaqfDeed` is superseded by `FoundationDeed`** but kept in the
  schema for historical rows; nothing writes a new one.
- **`CompliancePolicySet.requiresTrusteeLicense` defaults true**, so an
  unconfigured jurisdiction is flagged rather than silently cleared.
- **`/ops/sign-in` is unlinked**: obscurity, deliberately not relied on
  as a boundary.
- **The two frontends are one deployment**: merged on an informed
  decision; the access-control boundary is the backend guards, which
  the merge did not touch.

### 10. Testing discipline

- Every governed-entity mutation has a test asserting the matching
  `audit_logs` row.
- Every maker-checker-gated action has a test attempting
  `checker_user_id = maker_user_id` that confirms the DATABASE rejects
  it, not just the service.
- Every founder-scoped read/write has a test with a second, unrelated
  Founder fixture confirming isolation actually holds.
- No spec leaves fixture rows in a globally-visible table (§8).
- Flaky-under-load: any test asserting on a fire-and-forget side effect
  (a notification write the code under test doesn't await) must
  poll/retry with a real timeout, not a single fixed `setTimeout`.
- **Coverage asymmetry is itself a finding**: there are ~93 backend
  spec files and only ~5 frontend test files, for a frontend that
  renders money, enforces no-blending rules, and gates the donation
  flow. Identify the highest-consequence untested frontend logic
  (money formatting, progress/percentage math, error-vs-empty states,
  governed-action affordances) and say concretely what should be
  tested, rather than just noting the ratio.

### 11. Output

For each finding: file + line, a one-sentence summary of the defect, a
concrete failure scenario (specific input/state → specific wrong
outcome), and severity. Group by the sections above. If a section turns
up nothing, say so explicitly rather than omitting it — an audit silent
on a section is indistinguishable from one that skipped it.

Rank severity by consequence in a fiduciary system:
1. Money moves wrongly, or a ceiling/approval can be bypassed
2. Authentication, authorization, or Founder isolation breaks
3. Audit trail or maker-checker integrity is lost
4. Compliance/AML/PII exposure
5. Data correctness without money impact
6. UX, accessibility, performance
7. Style and consistency — report only if it hides one of the above
```
