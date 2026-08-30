# Birr — Core Service

This documents the product itself: what Birr does, who it's for, and
what happens at each stage. For the engineering operating model
(non-negotiables, tech stack, agent roster), see `CLAUDE.md` — this file
is the product-level counterpart to it, kept in sync with what's
actually built rather than what's planned.

## What Birr is

Birr is a **digital trustee for Islamic waqf (endowment)**. Birr itself
is appointed **Mutawalli (Trustee)** for every waqf established through
it. In plain terms: an organization or individual sets aside money,
property, or another asset permanently for a charitable purpose under
Islamic principles, and Birr is the accountable party that legally holds
and administers it, on an ongoing basis, going forward.

## Who it's for

- **Institutions** — Islamic banks, universities, corporate foundations,
  NGOs, family offices, governments, and official awqaf authorities.
- **Individuals** — a single person can establish their own endowment
  directly.

## The two postures

Birr deliberately operates in two different modes, not one rule applied
twice:

| | Establishment | Ongoing governance |
|---|---|---|
| Who acts | The Founder, self-service | Birr's own internal staff only |
| Approval gate | None — creating a Waqf Fund *is* the Founder's agreement that Birr becomes trustee | Every sensitive action requires a second, different person's sign-off (maker-checker) |
| Where it happens | Founder Portal (`app/(founder)`) | Ops Console (`app/ops`) |

A Founder never operates the governance machinery themselves after
establishment — that boundary is real, not cosmetic (see `CLAUDE.md`'s
non-negotiables for how it's enforced at the database level, not just in
application code).

## What a Founder can do themselves (self-service)

1. **Sign up and verify** — email and WhatsApp verification before
   establishing anything.
2. **Establish a Foundation** — the umbrella organization for their
   giving.
3. **Establish one or more Waqf Funds under it.** Four types exist in
   the data model:
   - **Investment** — capital that gets invested; the returns fund the
     cause.
   - **Asset** — a physical thing (real estate, etc.) endowed directly.
   - **Project** — funding tied to a specific project; can have more
     than one Founder behind it.
   - **Hybrid** — a mix of the above.
4. **Accept contributions into a fund** — three payment rails are
   built: card payments (Stripe), regional payments (Paystack), and
   stablecoin.
5. **Generate a waqf deed** — the founding legal document, drafted from
   jurisdiction-specific templates.
6. **View** their own Foundations, Waqf Funds, and contributions —
   Founder-facing surfaces are deliberately kept lightweight (view,
   request), never governance.

## What Birr's staff do afterward (the trustee work)

Once a waqf exists, everything from there on runs through Birr's own
staff, using internal tooling (the Ops Console), never the Founder:

- **Asset management** — including disposal decisions.
- **Investment management** — for investment-type waqfs.
- **Beneficiary administration** — finding and managing who the waqf
  helps.
- **Distribution management** — approving and making payouts.
- **Compliance monitoring** — against the regulatory framework of the
  waqf's own jurisdiction (not the Founder's).
- **Audit trail & reporting** — a permanent, append-only record of every
  governed action.
- **Conflict-of-interest management** — staff declare conflicts as
  structured data, not free text.

Birr's own staff are split into distinct functional roles — Mutawalli
Officer, Board of Trustees, Shariah Supervisory Board, Investment
Committee, Audit Committee, Risk & Compliance, Legal Adviser, External
Auditor — modeled explicitly in the permission system, not as a flat
admin/user split.

### The maker-checker rule

Every sensitive governance action (asset disposal, distribution
approval, investment changes, beneficiary-criteria changes) requires two
different people: one proposes, a different one approves. This isn't
just enforced by the application — it's a database constraint
(`checker_not_maker`) that rejects the same person appearing as both,
even across two roles they happen to hold. See `CLAUDE.md` for the exact
mechanism.

## Causes — organizing a Waqf Fund internally

A **Cause** is a theme or purpose bucket inside one Waqf Fund — e.g. an
"Education Waqf" might be split into "Scholarships" and "School
Supplies" causes. Every Beneficiary and every Distribution is tracked
against a Cause, so money is attributable to a specific purpose rather
than one undifferentiated pot.

- **Fully built** on both sides. Ops Console (Birr staff): create,
  retire, and manage the standard catalog; see a Cause's beneficiaries/
  distributions. Founder Portal: search and select from the catalog or
  propose a new one, plus read-only visibility into their own waqf's
  Assets, Investments, Distributions (by cause), Beneficiaries
  (aggregate counts only — never individual identities, matching
  standard endowment donor-confidentiality practice), and decided
  governance activity Birr staff have taken.

## AI assistance — advisory only, structurally enforced

Birr uses agentic AI to help staff, never to replace their judgment. The
fiduciary agents (compliance monitoring, caseload triage, anomaly
detection, investment research, onboarding assistance, distribution
prep) can only ever **propose** — write a draft, flag something, suggest
a value. None of them can **approve**. This isn't a permissions setting
someone could misconfigure: there is no `checker_agent_id` column
anywhere in the schema for an agent to occupy that role. A separate,
non-fiduciary agent drafts marketing content, always through human
review before anything publishes.

## One-sentence summary

Set up your own Islamic endowment in minutes, self-service — then let
Birr professionally and accountably run it for you, forever, under a
governance model where no single person (or AI) can ever unilaterally
move an endowment's assets.
