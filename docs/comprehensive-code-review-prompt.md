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
  patterns, (4) everything else.

---

## The prompt

```
Perform a comprehensive, careful review of the Birr codebase
(/home/mutalab/birr) — a fiduciary Islamic waqf trustee platform.
Read CLAUDE.md in full first; it defines the non-negotiables this
review checks against. This is a whole-codebase audit, not a diff
review — read the actual current source for every claim you make, do
not rely on comments, memory, or prior session summaries.

Work through each section below. For every item, find the actual
code that should enforce it, confirm it does, and try to construct a
concrete counterexample (a specific input, actor, or state) that
would break it. Report findings ranked by severity, each with the
exact file/line and a concrete failure scenario — not a general
concern.

### 1. Non-negotiables (CLAUDE.md), made concrete

- **Immutable audit trail**: for every model CLAUDE.md lists as
  governed (Founder, Waqf, Asset, Beneficiary, Distribution,
  Investment) and every model added since, confirm every
  create/update/delete path writes a matching `audit_logs` row with
  actor, actor type, before/after snapshot. Grep every `.service.ts`
  for a Prisma write with no adjacent `auditLog.create` in the same
  transaction. Confirm `audit_logs` truly has UPDATE/DELETE revoked at
  the DB role level (not just app-layer convention) — try it directly
  against the database if you have credentials, don't just read a
  migration file and assume it applied cleanly.
- **Maker-checker at the individual level**: for every
  `governed_actions` permission with `requiresMakerChecker: true`,
  confirm the DB has a real CHECK constraint rejecting
  `checker_user_id = maker_user_id` — read the actual constraint SQL,
  then write a test (or run one) that attempts it and confirms the
  database itself rejects it, not just `GovernedActionsService`. Flag
  any governed-action handler reachable without going through
  `governed_actions` at all (a controller route that mutates a
  governed field directly).
- **Founder/waqf isolation**: for every founder-facing read/write,
  confirm it's scoped via `withFounderScope` (both the RLS session
  variable and the app-layer WHERE clause) or an equivalent explicit
  ownership check — not just an app-layer WHERE alone, which regresses
  silently if the RLS policy itself is ever misconfigured. Confirm no
  founder-facing route can enumerate or act on another Founder's data
  by guessing an ID (test with a real second Founder fixture).
- **AI advisory-only**: confirm the `governed_actions` schema still has
  no `checker_agent_id` column, and that every `ai_agents`-authenticated
  route (`x-agent-api-key`) only ever writes drafts/proposals, never a
  `decide()`/approval path. Confirm each agent's tool allow-list
  (`services/agents/`) contains no "approve" tool.
- **Segregation of duties**: confirm `birr_staff` roles are modeled as
  a real enum/table, not a flag, and that role-permission seed data
  (`seed-data.ts`) never gives one role both `canMaker` and
  `canChecker` on the same permission. Flag any code path where a
  single person could plausibly both propose and approve an action
  across two roles they happen to hold simultaneously.
- **Conflict-of-interest declarations**: confirm these are structured
  fields (`conflict_of_interest_declarations`), not a free-text blob
  bolted onto another table.

### 2. Known trouble patterns (found and fixed before — check they
haven't regressed or recurred elsewhere)

- **Missing `checkDuplicate` guards on governed-action handlers**: a
  prior bug let the same still-pending target be proposed twice (a
  page reload resets local "already proposed" UI state, but nothing
  server-side blocked a second identical proposal). Confirm every
  handler in `GovernedActionsService`'s handler map implements
  `checkDuplicate`, not just some of them.
- **Test fixtures leaking real catalog data**: a prior bug had a spec
  file (`waqf-causes.service.spec.ts`) create real `CauseCategory` rows
  (a table end users actually see, e.g. a Founder's cause picker) with
  no `afterAll` cleanup — every full-suite run permanently polluted
  shared dev-database catalog data. Grep every `*.spec.ts` for
  `prisma.<model>.create` where `<model>` is a globally-visible,
  non-namespaced table (categories, policy sets, jurisdictions —
  anything not scoped to a fixture-only Foundation/Waqf/Founder), and
  confirm a matching cleanup exists. A fixture scoped to its own
  fixture Waqf/Foundation is fine even if never deleted (nothing else
  can see it); a fixture in a shared catalog table is not.
- **Notification read-state gaps**: a prior bug let a notification's
  target content be viewed through its own detail page/section without
  ever marking the underlying `Notification.readAt` — only clicking it
  inside the bell dropdown did, so an unread badge could get
  permanently stuck. For every notification `type` in
  `NotificationsService`'s `CHANNEL_PLAN`, confirm there's a real path
  (not just the bell) that marks it read when a user actually views
  what it points to.
- **Stale prebuilt backend process shadowing the dev server**: not a
  code bug, but has repeatedly cost real debugging time — confirm
  whichever process a reviewer/dev interacts with is genuinely
  `nest start --watch` (picks up file changes), not a stale
  `node dist/main` that silently doesn't. If auditing runtime
  behavior, verify the running process's start time is after the last
  relevant source change.

### 3. Architectural consistency

- **Dual-session controller pattern**: every controller reachable by
  both a Founder and Birr-staff session should follow the same shape
  (`@Public()` at the class level, a manual
  `isBirrStaffSession(request)` branch, `resolveFounderFromSession`
  for the founder path) — flag any controller that reinvents this
  differently, since a subtly different auth check is where isolation
  bugs hide.
- **Frontend type drift**: `apps/web/lib/ops-types.ts` and
  `apps/web/lib/types.ts` hand-duplicate many of the same shapes
  (`Waqf`, `Message`, `WaqfLifecycleStatus`, etc.) for the two route
  groups. Diff the two files for a shape that exists in one but not
  the other, or that's drifted in field names/types from what the
  backend actually returns — this is a real, structural risk of this
  duplication, not hypothetical.
- **Currency handling**: confirm every monetary aggregate
  (`platformSummary`, `founderSummary`, `summaryByCause`, financial
  reports, etc.) groups by currency and never sums across it. Grep for
  any `_sum`/reduce over an `amount` field that doesn't also group or
  filter by `currency`.
- **PII boundary (Founder Portal)**: confirm beneficiary names/contact
  info/bank details never appear in a response reachable by a Founder
  session — check every place `includeBeneficiaryNames` (or equivalent
  flags) defaults to `true`, and confirm no founder-reachable route
  passes `true` explicitly.
- **Soft-delete vs. hard-delete discipline**: confirm every model
  CLAUDE.md or a model's own schema comment says is soft-delete-only
  (governed entities, `CauseCategory`, etc.) is never hard-deleted from
  application code (a raw `deleteMany` reachable from a real route, not
  a one-off maintenance script).

### 4. Security

- **Guard coverage**: confirm `SessionAuthGuard`/`PermissionGuard`/
  `StaffRoleGuard` actually run on every non-`@Public()` route (spot-
  check a sample, don't just trust the global `APP_GUARD` registration
  — confirm provider-registration order in `app.module.ts` still has
  `SessionAuthGuard` before the other two, since NestJS guard order
  matters).
- **Webhook signature verification**: confirm every payment-provider
  webhook route recomputes and compares a signature over the *raw*
  body (not a re-serialized/parsed one) using `timingSafeEqual`, not a
  plain `===`. Confirm `main.ts`'s raw-body carve-out list is still in
  sync with every actual webhook route.
- **File upload validation**: confirm every upload path (logos, message
  attachments) validates mimetype against an explicit allowlist (never
  trusts the client-supplied `Content-Type` alone if avoidable), enforces
  a real size cap, and never accepts `image/svg+xml` or another
  script-capable format.
- **Secrets hygiene**: confirm no encrypted field's plaintext (bank
  details, provider credentials) ever ends up in an `audit_logs`
  snapshot, a log line, or a frontend response outside its owning
  session type.
- **RLS as defense-in-depth, not the only layer**: for any table with a
  Postgres RLS policy, confirm the app-layer WHERE clause is never
  removed on the assumption "RLS covers it" — both should independently
  hold.

### 5. Testing discipline

- Every governed-entity mutation has a test asserting the matching
  `audit_logs` row.
- Every maker-checker-gated action has a test that attempts
  `checker_user_id = maker_user_id` and confirms the database itself
  (not just the service) rejects it.
- Every founder-scoped read/write has a test with a second, unrelated
  Founder fixture confirming isolation actually holds.
- No spec file leaves fixture rows in a globally-visible table without
  cleanup (see §2).
- Flaky-under-load patterns: any test asserting on a fire-and-forget
  side effect (e.g. a notification write that isn't awaited by the
  code under test) polls/retries with a real timeout rather than a
  single fixed `setTimeout`, which is inherently racy under concurrent
  full-suite runs against a shared database.

### 6. Output

For each finding: file + line, a one-sentence summary of the defect, a
concrete failure scenario (specific input/state → specific wrong
outcome), and severity. Group by section above. If a section turns up
nothing, say so explicitly rather than omitting it — an audit that's
silent on a section is indistinguishable from one that skipped it.
```
