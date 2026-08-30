# Birr — Project Brief for Claude Code

## What this is
Birr is a digital trustee for Islamic waqf (endowment). Birr itself is
appointed **Mutawalli (Trustee)** for every waqf established through it
— but that trustee relationship attaches at **establishment**, not
before. A **Founder** (an institution — bank, university, family
office, NGO, government, awqaf authority — or an individual)
establishes their own **Foundation** (the organizational umbrella) and
**Waqf Fund(s)** under it directly, self-service, through the Founder
Portal — no Birr staff involvement, no approval gate. Creating a Waqf
Fund is itself how the Founder agrees Birr becomes Mutawalli over it.
From that point on, **ongoing governance** of an existing Waqf Fund —
asset disposal, distribution approval, investment changes,
beneficiary-criteria changes — is exclusively Birr-staff-mediated,
using Birr's own internal infrastructure (WaqfOS), through the
maker-checker `governed_actions` machinery below. Founders never operate
that governance machinery themselves; establishment and ongoing
governance are deliberately different postures, not the same rule
applied twice. This is a fiduciary system — correctness, auditability,
and access control matter more than feature velocity.

**The formal, signed deed appointing Birr as Mutawalli is
Foundation-level, not per-Waqf-Fund.** The original design (still
reflected in some older comments) had a founder sign a distinct deed
for each individual Waqf Fund — the reasoning being that each Waqf Fund
is legally its own distinct endowment (its own assets, purpose, type,
jurisdiction), which a single blanket agreement can't fully specify.
That reasoning still holds in the abstract; changed at the owner's
explicit, informed decision on 2026-08-27, after that tradeoff was
raised directly, because a Founder establishes more than one Waqf Fund
under the same Foundation over time and re-signing per fund didn't
match that reality — in practice it had also silently regressed to
every Waqf Fund after the first getting no deed at all. One
`FoundationDeed`, signed once, now covers a Foundation and every Waqf
Fund under it, present and future; see that model's own schema comment.
`WaqfDeed` (the superseded per-fund model) is kept in the schema
untouched, for any historical rows, but nothing writes a new one.

**Cause Allocation — how much of a fund's distributable money goes to
each selected Cause — is Founder self-service, not a `governed_actions`
type.** A Founder can set/change `WaqfCause.allocatedAmount` directly
(`WaqfCausesService.allocate`), the same self-service posture as
selecting the Cause itself, even though it's a real lever on how much
money eventually reaches that Cause's beneficiaries. This was raised
directly with the owner as a tension worth flagging — `distribution.approve`
and `investment.change` are Birr-staff-governed maker-checker actions
precisely because they move money, and allocation determines the ceiling
that governs those distributions — and the owner chose founder
self-service anyway, at their explicit, informed decision on 2026-08-27.
What still keeps this fiduciarily sound despite that: `allocatedAmount`
is a real enforced ceiling, not a decorative figure — `DistributionsService`
rejects any distribution (at both creation and governed-action approval)
that would push a Cause's committed total past what the Founder allocated
to it, so Birr staff still can't move money past what the Founder
declared, even without a maker-checker gate on the declaration itself.
Allocation always draws from the Founder's own raised corpus
(`amountRaised`), for every Waqf Fund type including Investment —
deliberately *not* from `WaqfProceeds` (investment returns), at the
owner's explicit direction after an initial draft of this feature drew
an Investment Fund's allocation from proceeds instead, reasoning from
classical waqf perpetuity (corpus preserved, only income spent) rather
than from how the owner actually wanted it to work. `WaqfProceeds`
still exists as its own thing — Birr-staff-entered (Investment
Committee/Mutawalli Officer) investment performance/compliance
reporting.

**Update, 2026-08-28 — `WaqfProceeds` is no longer *entirely* unrelated
to Cause Allocation.** A second, separate pool now exists:
`WaqfCause.proceedsAllocatedAmount`, set via
`WaqfCausesService.allocateProceeds`. Unlike corpus allocation above,
this one is **Birr-staff-decided, not Founder self-service** — a
Founder never observes investment performance directly, so there's no
self-service posture to extend to it. It only ever applies to
Investment-type Waqf Funds (every other type has no investment layer
at all, so never has proceeds to allocate). Critically, this is
*additive*, not a replacement: `allocatedAmount` (corpus, Founder-set)
is completely untouched by this — `DistributionsService
.assertWithinAllocation` now sums both fields as one Cause's real
ceiling, but each pool is still tracked, allocated, and enforced
independently, preserving the corpus-vs-income distinction the
2026-08-27 decision above was built on.

## Non-negotiables (apply to every feature, every session)
- **Immutable audit trail**: every create/update/delete on a governed
  entity (Founder, Waqf, Asset, Beneficiary, Distribution, Investment)
  writes an append-only record to `audit_logs` (actor, actor type,
  timestamp, before/after snapshot). Never hard-delete governed records —
  soft-delete + audit only. Revoke UPDATE/DELETE grants on `audit_logs`
  at the DB role level, not just the app layer.
- **Maker-checker at the individual level, not just the role level**:
  sensitive actions (asset disposal, distribution approval, investment
  changes, beneficiary-criteria changes) go through `governed_actions`,
  with a DB check constraint that the checker is never the same person
  as the maker — enforced by the database, not application logic alone.
- **Founder/waqf isolation, not tenant isolation**: there is no per-org
  admin console to isolate. Isolation is scoped through `waqf_founders`
  and `founder_memberships` — a Founder sees only the waqf(s) they
  established, nothing about any other Founder.
- **AI is advisory only — enforced structurally, not by policy**: any AI
  agent may act as a *maker* on a governed action (propose, draft, flag)
  by writing to `governed_actions` via its own `ai_agents` registry
  entry. No agent may ever be a *checker* — there is no `checker_agent_id`
  field, and none should be added. Every agent-initiated action must be
  traceable to a specific row in `ai_agents`, not an undifferentiated
  "the AI."
- **Segregation of duties within Birr's own staff**: Mutawalli Officer,
  Board of Trustees, Shariah Supervisory Board, Investment Committee,
  Audit Committee, Risk & Compliance, Legal Adviser, and External Auditor
  are distinct `birr_staff` roles with distinct permissions — these are
  Birr's own people, not each Founder's staff. Model this explicitly in
  the RBAC schema, not as a flat "admin/user" split.
- **Conflict-of-interest declarations**: required of `birr_staff` on
  waqf-specific or general governance matters; store as structured data
  (`conflict_of_interest_declarations`), not free text.

## Core entities (build in this order)
1. `users` (global accounts), `founders`, `founder_memberships`
2. `birr_staff`, `roles`, `permissions`, `role_permissions`
3. `waqfs` (type: Investment / Asset / Project / Hybrid), `waqf_founders`
   (join — a Project Waqf can have more than one Founder)
4. `waqf_case_assignments` (which Birr staff serve which function on a
   given waqf — the caseload concept)
5. `governed_actions` (the maker/checker enforcement point) and
   `ai_agents` (registry for agentic AI proposers)
6. `conflict_of_interest_declarations`
7. Asset, Beneficiary, Investment/Portfolio, Distribution (linked to a
   Waqf; these ride on the same governed-action pattern above)
8. Compliance report / audit export
9. `audit_logs` (cross-cutting, not a "module" — every write path touches
   it) and `invitations` (discriminated by founder_user vs birr_staff)

## Waqf lifecycle stages (for reference when scoping a milestone)
Establishment → legal documentation → asset registration → governance
configuration → investment management → beneficiary administration →
distribution management → compliance monitoring → financial reporting →
impact measurement → audit → succession management → long-term
preservation.

## Governance standards to align with
AAOIFI governance standards, IFSB principles (governance, risk, Shariah
oversight), general fiduciary/endowment governance practice, and
applicable national regulatory requirements in each jurisdiction where
Birr is appointed trustee. `waqfs.jurisdiction` (not the Founder's home
jurisdiction) is what should drive which compliance policy set applies —
don't hardcode one jurisdiction's rules.

## Regulatory & assurance posture to keep in mind
Acting as trustee for other institutions' endowed assets is, in most
jurisdictions, itself a regulated activity — separate from and beyond
security certification. Don't assume SOC 2 alone covers this. Flag
anywhere the system would need to represent jurisdiction-specific trustee
licensing status, since that's a real constraint on which jurisdictions
Birr can actually operate as Mutawalli in at a given time.

## Tech principles
- Cloud-native, API-first (every feature needs an API before/alongside UI)
- Security and privacy by design
- Modular — governance workflow engine should be generic, not bespoke per
  entity type
- Interoperable with external Islamic financial institutions (design for
  future integrations, don't hardcode assumptions that block them)
- Founder-facing surfaces stay lightweight (view, request) — the
  governance engine lives entirely on the Birr-staff side
- Human decision authority preserved everywhere AI touches the system

## Tech stack (confirmed)
- **Frontend — Next.js (TypeScript, App Router), one deployment
  (`apps/web`)**, split into two route groups: `app/(founder)`
  (lightweight — view, request; public landing page, public sign-up/
  sign-in) and `app/ops` (internal, higher privilege — case management,
  approvals, agent review queues; sign-in at `/ops/sign-in`, not linked
  from anywhere public). **Originally built as two separate
  deployments specifically so a compromise in the lower-trust
  Founder-facing surface had no code-level path into Ops Console** — that
  reasoning still holds in the abstract; merged on 2026-08-24 at the
  owner's explicit, informed decision, after that tradeoff was raised
  directly. What's preserved despite the merge: each route group has its
  own session provider/layout and no shared client state between them,
  and the actual access-control boundary was never "which port" — it's
  the backend guards (`SessionAuthGuard`, `PermissionGuard`,
  `StaffRoleGuard`), untouched by this change. `/ops/sign-in` being
  unlinked is obscurity, not access control; don't treat it as a real
  security boundary when reasoning about this system's threat model.
- **Backend — Node.js/TypeScript with NestJS**, standalone from both
  Next.js apps. Reasons this isn't just Next.js API routes: (1) the
  frontend split only holds if authorization logic lives outside either
  frontend, not inside one of them; (2) there are more callers than two
  web apps — the Agent Service and, eventually, external Islamic
  financial institution integrations, all need the same API; (3) Rasid's
  and Nazim's scheduled/background work needs a persistent process, not
  short-lived request handlers; (4) NestJS's guards/interceptors let the
  role-permission + individual maker≠checker + audit-log checks be
  declared once and applied uniformly across every write path, rather
  than repeated by convention across many route handlers.
- **Agent framework — Claude Agent SDK (TypeScript)**, run from the
  standalone Agent Service, calling the NestJS backend's API rather than
  writing to the database directly. Each of the seven agents
  (Rasid, Nazim, Kashif, Rashid, Rafiq, Munsif, Bashir) gets its own
  explicit tool allow-list — a "propose" tool where relevant, never an
  "approve" tool for any agent. This reinforces the `checker_agent_id`
  omission at the schema level with a matching restriction at the
  tool-permission level.
- **Scheduling — start simple**: basic cron/queue for Rasid's and
  Nazim's recurring runs, with `governed_actions.status = 'proposed'`
  already serving as the "waiting on a human" pause state. Reach for
  Temporal only once enough concurrent agent workflows make execution
  history genuinely hard to track without it — not by default.
- **Database — Postgres**, managed (RDS/Supabase/Neon), with Row-Level
  Security scoping by waqf/founder as a second enforcement layer beneath
  the app, and the `pgvector` extension for Rasid's/Kashif's semantic
  search needs rather than a separate vector database.
- **Auth** — WorkOS or Auth0 (re-evaluate at actual pilot connection
  count, as discussed); either way, keep RBAC in the NestJS backend's own
  schema (`roles`/`permissions`/`role_permissions`), using the provider
  for authentication only.

## Agentic AI — nicknames, graduation gates, and one new agent
Nicknames below are internal — for code, logs, and this brief — not
customer-facing branding. Two tracks, with two different kinds of gate:
fiduciary agents graduate toward writing `governed_actions`; the
marketing agent graduates toward less human review before publishing,
never toward zero.

### Fiduciary agents (feed into `governed_actions`)
Agents may propose; only a human Birr officer may approve. Enforced by
the schema itself (no `checker_agent_id` column exists), not convention.

| # | Agent | Nickname | Does | Starts as | Graduates to writing `governed_actions` when |
|---|---|---|---|---|---|
| 1 | Compliance & regulatory monitoring | **Rasid** ("the observer") | Watches jurisdiction-specific regulatory change per waqf, drafts impact summaries, assembles audit evidence continuously | Draft-only reports, no system writes | Officers consistently act on its drafts without correcting them |
| 1 | Officer caseload triage | **Nazim** ("the organizer") | Surfaces what needs attention today across a `waqf_case_assignments` caseload | Draft-only prioritized view | Rarely needs to — may never write `governed_actions` at all |
| 2 | Anomaly & conflict-of-interest detection | **Kashif** ("the revealer") | Pattern-spots unusual maker/checker pairings and atypical timing across `governed_actions` history | Draft-only flags for review | Only if you want it auto-opening a formal review case — not required |
| 3 | Investment research support | **Rashid** ("the wise") | Shariah-compliance screening, portfolio drift monitoring, draft memos for the Investment Committee | Draft memos only | Milestone 4 (investment module) exists **and** Rasid/Nazim have run clean in production |
| 4 | Founder onboarding & waqf establishment | **Rafiq** ("the companion") | Guides a Founder through *self-service* Foundation/Waqf Fund establishment in the Founder Portal, drafts initial deed content from jurisdiction templates for the Founder's own review | Draft form/deed content for the Founder — not a Birr officer — to review before submitting | Doesn't — establishment is no longer a `governed_actions` concept at all (a Founder's own action, not a proposal a Birr officer approves), so there's nothing for Rafiq to graduate into writing. Its assistance stays scoped to helping the *donor* fill in what they submit themselves |
| 5 | Beneficiary verification & distribution prep | **Munsif** ("the fair one") | Checks eligibility, flags duplicates, drafts distribution recommendations | Draft recommendations only | Milestone 6 (beneficiary/distribution module) exists **and** every earlier agent has a clean production track record — this one directly precedes money reaching a real person |

**The gate, in one sentence:** an agent advances to writing
`governed_actions` directly only when its current draft-only tier has run
in production for a stretch with zero maker/checker exceptions and no
officer complaints about proposal quality — not on a fixed schedule.

### Non-fiduciary agent

| Agent | Nickname | Does | Gate |
|---|---|---|---|
| Business development & digital marketing | **Bashir** ("the herald") | Drafts marketing content, campaign copy, social/blog posts, competitor and market research, outreach drafts to prospective Founders | Never auto-publishes — draft → human review → publish, always. Any claim about licensing status, returns, guarantees, or regulatory compliance requires **Legal/Compliance sign-off specifically**, not just any Birr staff member — marketing communications about a fiduciary service are themselves regulated in most jurisdictions ("financial promotion" rules), separate from the waqf-governance rules the fiduciary agents operate under. |

Bashir never touches `governed_actions` — it isn't a fiduciary decision.
Its published output should still write to `audit_logs`
(`actor_type = ai_agent`, action `content.published`) for the same reason
everything else does: what went out, and who approved it, stays
attributable.

## How to work on this repo
- Plan before coding on anything touching money, approvals, or permissions.
- Vertical slices: model + migration + API + tests + minimal UI per
  entity, not whole modules in one pass.
- Every mutation on a governed entity needs a test asserting an
  `audit_logs` record was written.
- For anything routed through `governed_actions`, write the test that
  attempts checker_user_id = maker_user_id and confirms the database
  itself rejects it — not just the application layer.
- Flag any place a single person could both propose and approve an
  action, even across two different roles they happen to hold — that's a
  maker-checker bug, not a style issue.
