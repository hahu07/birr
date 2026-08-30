# Succession & Long-Term Preservation — Scoping Notes

Status: **policy decided (2026-08-30), not yet built**. This documents
what these two stages mean and the open questions that blocked scoping
real work, found and written up during the 2026-08-25/26
production-readiness audit (see the punch list — these were the two
lifecycle stages with zero representation anywhere in the codebase,
backend or frontend). See "Policy decision" below for what's now
resolved and what's still open before either becomes a real plan.

These are the last two of CLAUDE.md's thirteen waqf lifecycle stages:

> ... distribution management → compliance monitoring → financial
> reporting → impact measurement → **audit → succession management →
> long-term preservation**.

## Why these two exist at all

A waqf is explicitly meant to be **perpetual** — some real-world waqfs
have run for centuries. Every other lifecycle stage assumes the people
and systems involved today are the ones handling it. These two stages
exist because that assumption eventually breaks: people leave, companies
change, software gets replaced. A waqf has to outlive all of that by
design, or it isn't really a waqf.

## Succession management — what happens when the person in charge changes

Three distinct scenarios, currently all unhandled:

1. **A Foundation's primary contact is gone** (dies, retires, leaves the
   institution). Team invites (built 2026-08-25) let a primary contact
   *share* access, but nothing lets someone *inherit* the top slot if
   the primary contact never reassigns it themselves first. If they're
   simply unreachable, the Foundation has no path to a new primary
   contact today.
2. **An institutional Founder's leadership changes** (new bank CEO, new
   university trustee) without the actual legal entity changing. Is
   there a defined way to reflect that continuity without losing the
   audit trail of who was accountable when?
3. **Birr itself transfers trusteeship** — retirement from a
   jurisdiction, a merger, a regulatory requirement to hand off. Nothing
   in `governed_actions` or anywhere else models "Mutawalli changes
   from Birr to a successor trustee" as an event at all.

## Long-term preservation — will the record survive

Not "does the app back up its database" — this is specifically about
the legal/evidentiary record surviving **independent of Birr's own
continued existence**:

- If Birr the company shuts down, gets acquired, or migrates its stack,
  do signed deeds (`WaqfDeed.deedText`), the audit trail
  (`audit_logs`), and distribution history survive intact, or do they
  live and die with one company's Postgres instance?
- Is there an archival posture for the legal documents specifically,
  separate from ordinary infrastructure backups?
- Can someone prove, decades later, exactly what was agreed to and what
  happened to the money — independent of whether Birr's current tech
  stack, or Birr itself, still exists?

## Why this wasn't scoped alongside the other audit findings

Every other item from the production-readiness audit was a **feature or
a bug** — something with a clear "what does correct look like" that
could be built directly (founder team invites, the deed-disclosure fix,
the AI Agents oversight page, etc.). These two are different: they need
a **policy decision** before there's anything to build.

Concretely, before scoping either into a plan:

- **Succession**: does Birr need a real "reassign primary contact" /
  "trustee succession" workflow now, pre-launch, or is this a
  someday-problem once there's real institutional adoption at stake?
  If now — who's allowed to initiate a succession (the outgoing primary
  contact, another active member, Birr staff on request), and what's
  the evidentiary bar (is this itself a `governed_actions`-style
  maker-checker event, given how consequential handing over control of
  an endowment is)?
- **Preservation**: is this primarily a legal/compliance answer (escrow
  arrangements, regulatory retention requirements, a designated
  document-of-record custodian independent of Birr) rather than an
  engineering one? If there's an engineering piece, what's the actual
  failure mode being protected against — Birr's own database loss, or
  Birr's own institutional discontinuity?

## Policy decision (2026-08-30)

The owner's answer to the "why now vs. someday" question above:
**the company assumes it is a going concern** — Birr does not plan for
its own shutdown, acquisition, or discontinuity as a live risk to
design against. This resolves the two "why now" questions differently:

**Long-term preservation — resolved, no new feature needed.** The
doc's own framing above asked whether the failure mode being protected
against is "Birr's own database loss, or Birr's own institutional
discontinuity." Under a going-concern assumption, the second one isn't
a live risk to engineer around — there's no successor-custodian,
escrow, or independent-of-Birr archival posture to build. What's
already in place under CLAUDE.md's own non-negotiables — the immutable
audit trail (`audit_logs`, insert-only at the DB role level), signed
deeds stored as their own durable rows (`WaqfDeed`/`FoundationDeed`,
DB-trigger-enforced immutable), and ordinary infrastructure backups —
**is** the preservation mechanism, as long as Birr continues operating.
Nothing further to scope here; this stage should be treated as
structurally satisfied by existing non-negotiables rather than a gap.

**Succession management — narrows to the Founder side only.** Of the
three scenarios above, scenario 3 (Birr itself transferring
trusteeship to a successor) is exactly the institutional-discontinuity
case the going-concern assumption sets aside — genuinely a someday
problem, not scoped now. Scenarios 1 and 2 are different in kind: a
Foundation's primary contact leaving, or an institutional Founder's
named leadership changing, are ordinary, expected real-world events
regardless of Birr's own continuity, and today the product has no path
through either one. **This is the real, buildable scope**: a
Founder-side succession workflow — reassigning who holds
`primary_contact` on a Foundation when the current holder is gone or
unreachable, preserving the audit trail of who was accountable when.

**Still open before this becomes a plan**: who's allowed to initiate a
succession (the outgoing primary contact themselves, another active
member, Birr staff on request — or some combination depending on
whether the outgoing contact is reachable), and whether reassigning
`primary_contact` needs its own maker-checker gate given how
consequential handing over control of an endowment's donor-side
authority is — a real design fork, not yet answered.

## Next step

Succession management (Founder-side scope, above) is ready to become a
normal scoped plan once the "who can initiate, maker-checker or not"
question is answered — vertical slice, tests asserting the audit
trail, live verification, same as every other feature built this way
in this codebase. Long-term preservation needs no further scoping —
see above.
