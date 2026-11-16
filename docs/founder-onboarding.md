# Founder Onboarding — How It Actually Works

This documents the real, current behavior of the founder onboarding
wizard (`app/(founder)/onboarding/*`) — not a design proposal. Kept in
sync with what's built, same posture as `docs/core-service.md`.

Onboarding is the only path to establishing a waqf. It's four steps,
strictly gated in order, computed live on every request from real
database state — never a cached "current step" field (see
`FoundersService.getOnboardingStatus`). Every step's actual prerequisite
is independently re-checked at the point of write too, not just read
from the wizard's own progress view — the wizard is UX, not the
enforcement.

## The four steps

**1. Verify** — email and WhatsApp.
Sign-up creates a `User` row and sends a verification email (Resend).
Separately, a WhatsApp number gets a one-time code. Both must clear
before step 2 is reachable — this is Birr confirming a real, reachable
person exists before anything can be established.

**2. Founder & Foundation.**
One form (`onboarding/founder-foundation`), submitted together:
- **Who's establishing**: an institution (bank, university, corporate
  foundation, NGO, family office, government, awqaf authority, other),
  an individual, or **jointly, with family or friends** (2026-11-14).
  "Jointly" is recorded as an individual founder on a Foundation with
  `establishedJointly`, and opens the co-founder invites straight away;
  an informal group is never an institution.
- **The Foundation itself**: name, purpose, jurisdiction, optional logo.

The **Purpose** field has a "✦ Help me write this" button — **Rafiq**
(Birr's onboarding assistant) drafts a suggested statement from what's
been typed so far, which the Founder can accept, edit, or ignore.
Nothing is ever auto-submitted on the Founder's behalf.

This step **takes effect immediately** on submit — no Birr staff
involvement, no approval gate (`POST /founders/establish`). Creating the
Foundation *is* how the Founder agrees Birr becomes trustee over
whatever gets established under it.

**3. Waqf Fund.**
The first Waqf Fund under that Foundation — one of three types
(Investment / Asset / Project) — then a real contribution
(Paystack in Naira; Stripe was removed on 2026-09-19 and stablecoin on
2026-11-15, see CLAUDE.md) to fund it. The fund's status only
flips to `active` once that first contribution actually confirms; step 4
isn't reachable before that.

**4. Sign deed.**
A typed-name e-signature on the Foundation's Deed of Waqf — one deed per
Foundation, covering every Waqf Fund under it, present and future (the
per-fund `WaqfDeed` is superseded; see CLAUDE.md). The page shows the
full deed text exactly as it will be stored
(`GET /foundation-deeds/:foundationId/preview`), and signing is refused
if that text changed after it was shown. The rendered `deedText`
(`foundation-deeds/foundation-deed-template.ts`) is snapshotted verbatim
onto the `FoundationDeed` row and never regenerated.

For a joint Foundation (established jointly, or with more than one
founder by signing time) the deed is the joint variant: the signer signs
for themselves and every co-founder, present and future, and the deed
lists the current co-founders. Each co-founder, when accepting their
invitation (`/ops/accept-invitation?kind=co_founder`), accepts a
statement — authorizing the signer if the deed isn't signed yet, adopting
it if it is — stored as an immutable `CoFounderDeedConsent`.

Once all four are done, the Founder lands on the real dashboard —
Overview, Portfolio, Impact, Team.

## Who can do what

Steps 2–4 are all restricted to the Foundation's **primary contact**
specifically (`assertPrimaryContact`, in `common/auth/current-founder.ts`)
— establishing a Foundation or Waqf Fund, initiating a contribution, and
signing the deed are all org-commitment actions. A teammate invited
later (Team page, any permission level) can view everything the primary
contact can, but can't commit the organization to anything.

An invited teammate also **skips straight to the dashboard**, not back
through steps 1–2 — those steps establish a person's own identity, which
their invitation already vouches for (same posture as an invited Birr
staff member). `getOnboardingStatus` only gates on a *user's own*
email/WhatsApp verification when they have no Foundation membership at
all yet; once any active membership exists, the relevant question
becomes the *org's* progress (funded? deed signed?), not that specific
person's step-1 status.

## What Birr staff never touch here

None of this reaches the Ops Console. Establishment is deliberately the
one part of a waqf's life that's entirely self-service — see
`core-service.md`'s "two postures" table for why that's a different
posture from *ongoing* governance (which is Birr-staff-only, maker-
checker gated, and never something a Founder operates directly).
