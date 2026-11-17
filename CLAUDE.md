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

**Update, 2026-09-04 — reversed, for Investment-type Waqf Funds only:
corpus is no longer itself distributable.** `DistributionsService
.assertWithinAllocation` now enforces `proceedsAllocatedAmount` alone
as an Investment-type Cause's real ceiling — `allocatedAmount` (corpus)
no longer counts toward what a distribution can draw against for that
one type. This directly reverses the "every type including Investment"
half of the 2026-08-27 decision above, back toward the classical waqf
perpetuity reasoning that decision explicitly considered and overruled
at the time (corpus preserved, only income spent) — raised again
directly with the owner, who this time chose perpetuity over the
original self-service-lever framing, at their explicit, informed
decision on 2026-09-04. Asset and Project types are untouched by this:
neither has a proceeds concept at all (`WaqfProceedsService` only
accepts Investment-type waqfs), so `allocatedAmount` remains their
only, and still fully distributable, pool — corpus preservation only
ever applied to the classical invested-endowment case to begin with.
One real consequence worth a founder-facing pass later, not done here:
`WaqfCause.allocatedAmount` on an Investment-type waqf is now a corpus
target/preservation record, not a spending ceiling — any Founder Portal
copy still describing corpus allocation as "how much reaches your
cause's beneficiaries" is only accurate for Asset/Project funds now,
not Investment.

**Update, 2026-09-10/11 — Vault, a second product alongside everything
above.** Everything in this "What this is" section up to here describes
one product: a Founder establishes a Foundation and Waqf Fund(s),
self-service, and Birr becomes Mutawalli over what they establish.
Vault is a deliberately separate product built alongside it — a
Birr-staff-curated public-giving campaign (e.g. "Ramadan Relief Vault")
that anyone can give to directly, with no Founder, no Foundation, no
deed, and no account of any kind involved. The owner's explicit,
foundational instruction when this was built: the existing Founder
system stays completely untouched; Vault caters to non-Founders as its
own product, while reusing existing infrastructure (payment provider
adapters, the `CauseCategory` catalog, the `governed_actions`
maker-checker engine, the `Counterparty` registry) rather than
duplicating any of it. Vault payouts go to a `Counterparty`
(delivery/relief partner), not a new individual-beneficiary registry —
pooled public giving is a different scale than a Founder's own vetted
Beneficiaries; `VaultContribution` is a plain ledger row with no
`Asset`-registry equivalent, since Vault money is fungible pooled cash,
not an individually-valued asset. Vaults are created and curated
**exclusively by Birr staff**, confirmed directly with the owner — never
a Founder, and never a new self-service role. See `docs/core-service
.md`'s own "Two products, one trustee" section for the full
product-level explanation; this note exists so this section above isn't
read as the complete picture of what Birr now is.

**Update, 2026-09-13, decided 2026-09-15 — Vault's AML check can still
be bypassed by giving under a different email each time; accepted as a
residual risk for v1, covered by manual/off-platform review instead of
a code change.** `VaultContributionsService.findOrCreateDonor`
(vault-contributions.service.ts) is where the anti-structuring check
lives — a donor crossing `VaultDonorThreshold` requires a full name and
ID. That check accumulates across currencies (giving just-under-
threshold amounts in several currencies doesn't avoid it — see that
method's own comment for how), but it still only ever recognizes a
donor by `donorEmail`. There is no account, login, session, phone
number, or any other identity signal collected today — a donor who
types a genuinely different email on every gift gets a genuinely
different, blank-history `VaultDonor` every time, and can split one
large gift into many smaller ones this way without ever triggering ID
capture. In plain terms: give $9,999 five times under five different
emails and the platform sees five unrelated small donors, never one
$50,000 donor.

Three closing options were laid out on 2026-09-13: (1) a second
identity signal (phone number, device fingerprint) so different emails
can still be linked; (2) requiring ID upfront above a flat amount
regardless of a donor's history; or (3) accepting the residual risk for
v1, relying on manual/off-platform review instead. The owner chose (3)
explicitly on 2026-09-15 — this is now v1's actual, intended posture,
not an open question. No code change was made to the giving flow
itself; nothing about `findOrCreateDonor`'s single-`donorEmail`
identity model changed. The mitigation is procedural: Birr's
compliance/risk staff are expected to periodically query
`VaultContribution`/`VaultDonor` off-platform (e.g. donors sharing a
name, IP, device, or amount pattern across different emails within a
short window) rather than relying on the in-app threshold check alone
to catch structuring. Revisiting options (1) or (2) later, once real
giving volume makes the residual risk harder to accept, is real
follow-on work — not something this decision forecloses.

**Update, 2026-09-13 — Sanctions/PEP screening vendor picked:
ScreenShield, starting on its Starter tier.** The original Vault plan
deferred automated sanctions/PEP screening entirely, pending a vendor
choice. Considered against the same jurisdiction-driven logic this file
already applies to compliance policy generally (`waqfs.jurisdiction`
drives which policy set applies, not a Founder's home jurisdiction; see
the Regulatory & assurance posture section above) — Birr today operates
only as a non-profit registered in Nigeria, so a screening vendor that
ignores Nigeria's own domestic list in favor of Western-market-only
coverage is a materially weaker fit than one that doesn't:
- **ComplyAdvantage** (full case-management platform, enterprise sales
  process, no published pricing) and **Sanctions.io** (established,
  transparent usage-based pricing, OFAC/UN/EU/HMT + 1M+ PEPs) were both
  considered and are both credible, API-first options — but neither
  screens against Nigeria's own NFIU list, only the generic
  international sanctions regimes.
- **ScreenShield** (Mulanji Technologies, Nigeria, RC 1909785) is the
  only option found that screens Nigeria's NFIU domestic designations
  specifically, alongside OFAC/UN/EU and 1M+ worldwide PEPs, with a
  REST API, a sandbox available within 24 hours, and published tiered
  pricing (Starter $249/mo — 5,000 calls, international lists + PEPs;
  Growth $749/mo — adds NFIU + goAML filing; Scale $1,999/mo). Built
  specifically for African PSPs/fintechs facing CBN/BoG-style
  enforcement, which is a closer match to Birr's actual regulatory
  environment than a generic global vendor.
- Starting on **Starter**, not Growth: matches this codebase's own
  "start simple" posture (see Tech principles) — get real screening
  live against the major international lists first, at the lower cost
  a non-profit can actually sustain, and treat the NFIU/goAML upgrade
  (Growth tier) as a flagged next step once real transaction volume or
  a specific regulatory ask justifies the added cost, not a day-one
  requirement.

This is a documented direction, not a signed contract or a finished
integration — before any commercial commitment, Birr's own leadership
still needs to independently verify ScreenShield's claims (its stated
BCC licence, CBN/BoG examination-readiness, data protection terms) and
negotiate real commercial terms; none of that can be substituted for by
picking a vendor from its own marketing site. The actual engineering
work (a screening call at donor/Founder/Counterparty onboarding,
wired through `governed_actions` the same way every other Vault safety
feature has been) is separate follow-on work, not done here.

**Update, 2026-09-15 — Counterparty onboarding screening shipped;
Founder establishment screening designed, then rejected: Founder
self-service must never be gated on an automated screening result.**
`SanctionsScreening` (see `packages/db/prisma/schema.prisma`),
`ScreenShieldAdapter`, and `SanctionsScreeningService` now exist and
gate `counterparty.onboard` (commit `8177b0e`) — a screening hit *or* a
screening error (vendor unconfigured/unreachable) both land a
Counterparty in `under_review` until a `compliance_officer` resolves it,
fail-closed, per this file's own "human decision authority preserved"
principle.

Extending that same pattern to Founder establishment was designed next
— Founder establishment has no approval gate to hook a block into (it's
self-service; creating a Waqf Fund is itself how Birr becomes Mutawalli,
per this file's own "What this is" section), so the design had
establishment always succeed, with a hit/error instead flipping the new
Founder to a `under_review` status blocking their *next* real
money-moving step (first Waqf Fund creation, Foundation Deed signing, a
contribution) via the existing `assertFounderVerified` chokepoint,
until resolved.

**The owner rejected this design outright**, not merely for now. Two
reasons, raised directly: (1) ScreenShield is a picked vendor, not an
actual signed contract (see the note directly above — "before any
commercial commitment, Birr's own leadership still needs to
independently verify ScreenShield's claims... none of that can be
substituted for by picking a vendor from its own marketing site"), so
every screening call today resolves to `error` (unconfigured), which
the fail-closed design above treats identically to a real hit — meaning
**every founder, not just suspicious ones**, would be frozen out of
funding their own first Waqf Fund right after signing up. (2) More
fundamentally: self-service is the entire point of the Founder Portal —
a Founder should be able to establish, fund, sign, and contribute in
full, with nothing gated behind an automated screening result, and that
holds independent of whether ScreenShield is ever actually under
contract. This is a standing principle for this codebase going forward,
not a "come back once the vendor is real" deferral: **no future session
should propose blocking any Founder self-service action —
establishment, Waqf Fund creation, deed signing, contribution
initiation — on a sanctions/PEP screening result, automated or
otherwise.** If Founder-level screening is ever wanted again, it needs
a fundamentally different shape than "block the founder until a human
clears them" — e.g. a purely observational flag surfaced to Birr staff
for manual, off-platform follow-up (the same posture already chosen for
Vault's AML email-splitting gap on 2026-09-15), never a chokepoint a
founder's own actions can hit.

**Update, 2026-09-15 — Vault donor screening rejected too, same day,
same reasoning.** The 2026-09-15 `SanctionsScreening` schema comment
originally named Vault donor ID-capture screening as a separately
deferred slice, alongside Founder establishment, once a second concrete
consumer justified generalizing the model. Considered immediately after
the Founder rejection above and rejected for the same two reasons, not
pursued as a distinct slice: ScreenShield isn't under a real contract,
so the same fail-closed `error` path would fire for every donor who
crosses `VaultDonorThreshold` and provides a full name/ID — a narrower
population than "every founder" (only donors already large enough to
need ID capture, not every giver), but the same mistake in miniature —
and it would land directly on top of the AML email-splitting gap
(`VaultContributionsService.findOrCreateDonor`, see the 2026-09-13/15
update above), where the owner already chose manual/off-platform
compliance review over an automated block on a donor's own gift. Same
standing principle as the Founder note above, applied here too: an
automated sanctions/PEP result should never hold up a real donor's
contribution — if Vault donor screening is revisited, it takes the same
observational-flag-for-manual-review shape already chosen for the AML
gap, not a payment-blocking gate.

**Update, 2026-09-16 — Counterparty onboarding screening reverted
before launch: Birr does not run ScreenShield at all for now.** The
Counterparty-onboarding slice described above (`SanctionsScreening`,
`ScreenShieldAdapter`, `SanctionsScreeningService` — commit `8177b0e`)
was built, tested (77 passing specs), and verified working end-to-end
through the Ops Console the same day it shipped: a screening hit or an
unconfigured-vendor error correctly landed a Counterparty in
`under_review` until a compliance officer resolved it. Reverted the
following day, on the owner's direct instruction: Birr cannot run
ScreenShield for now — the actual engineering work waits until after a
successful launch, or until a specific regulatory authority actually
asks for it, not built and left running ahead of that need.

This is a different kind of call from the Founder/Vault-donor rejections
above — those were architecture objections ("self-service should never
be gated on an automated result," a standing principle regardless of
vendor readiness). This one isn't: the Counterparty-onboarding shape
itself was sound and already proven working end-to-end; it's a
launch-timing call on code that worked, not a design flaw. `counterparty
.onboard` is back to its original two-gate shape (Shariah sign-off, then
the governed action itself) — exactly as it was before ScreenShield
existed, no `under_review`-for-screening path, no `SanctionsScreening`
model. Whenever this is picked back up (post-launch, or on a specific
regulatory ask), the same shape documented above should still hold —
nothing about the design was wrong, only its timing.

**Update, 2026-09-13 — a Vault can now accept giving in more than one
currency.** Until now `Vault.currency` was the one currency a vault
could ever take a contribution in — raised directly by the owner
(a real campaign like "Ramadan Relief" reasonably wants to accept USD,
NGN, and stablecoin gifts together, not force a donor to match one
fixed currency). Two decisions, both the owner's:
- **Separate totals per currency, never converted into one figure.**
  `VaultsService.withAmountRaised` now groups by currency
  (`{currency, amount}[]`, not a single number) — a donor giving in NGN
  sees "₦500,000 raised," not a made-up combined total requiring a
  live exchange-rate feed this codebase deliberately doesn't take on
  for a fiduciary system reporting on money. Same posture
  `VaultContributionsService.findOrCreateDonor`'s AML check already
  takes (compare each currency on its own terms, never convert).
- **Contributions first, allocation later — a deliberately scoped first
  slice, not the full picture.** `Vault.additionalCurrencies: String[]`
  lets a vault accept gifts in currencies beyond its primary `currency`
  (`VaultContributionsService.initiate` validates against the full set).
  `targetAmount`, `VaultCause.allocatedAmount`/`proceedsAllocatedAmount`,
  the shared allocation-ceiling check, and `VaultDistribution` payouts
  all deliberately stay `currency`-only for now — a distribution still
  can't be created in one of the additional currencies, and the
  goal/progress bar shown on the public page is the primary currency
  alone (any additional-currency total gets its own separate line, not
  folded into the goal's progress bar). Extending allocation/payouts to
  be currency-aware too is real, flagged follow-on work, not an
  oversight — the owner chose to ship giving-side support now rather
  than hold it for the larger redesign.

**Update, 2026-09-16 — that follow-on work is done: Vault cause
allocation and distributions are now currency-aware too.** `VaultCause
.allocatedAmount`/`proceedsAllocatedAmount` (bare, single-currency
Decimal fields) are replaced by `VaultCauseAllocation` — one row per
`(vaultCause, currency)` — so a vault with `additionalCurrencies` can
allocate and pay out each accepted currency's own raised pool
independently, the same "never blend currencies together" posture
`withAmountRaised` above already established for giving. A
`VaultDistribution` can now be created in any of the vault's accepted
currencies, not just its primary one; each currency's allocation
ceiling is enforced completely independently of the others (committing
against one currency never eats into another's headroom). Found and
fixed two related bugs while wiring this up: `VaultProceedsService
.sumForVault` was aggregating with no currency filter at all (silently
blending currencies), and `record()` never validated a proceeds
currency against the vault's accepted set — both fixed the same way.
The goal/progress bar on the public page is still primary-currency-only
per the note above; that part of the "not the full picture" scoping
still stands.

**Update, 2026-09-19 — Stripe removed as a donation option: Nigeria
isn't a country Stripe operates in at all.** `apps/backend/src/modules
/contributions/providers/stripe.adapter.ts` was, and still is, a
genuinely real integration — real Checkout Sessions, real webhook
signature verification, real refunds — not a stub. It never worked in
practice for one reason that has nothing to do with the code: Stripe
does not support Nigeria as a country for opening a Stripe account at
all, for any purpose. Confirmed two ways — against Stripe's own current
documentation, and by the owner directly trying to open one, where
Nigeria simply isn't offered as a country option. This is exactly why
Paystack (which Stripe itself acquired) exists as a separate product
for this market in the first place; there is no route to a
Birr-owned Stripe account under Birr's current legal entity, so
"Card (international)" could never have processed a real donation
regardless of how correct the adapter code was.

This is the same underlying blocker `PayoutProvider`'s own schema
comment already flagged for the *payout* side (Stripe Connect can't
hold a Nigerian recipient account either) — this update extends it to
the *contribution* side too, where it hadn't been noticed yet because
the adapter looked, and was, fully built.

Removed "Card (international)" from both donation entry points
(`WaqfFundForm.tsx`, `vaults/[slug]/page.tsx`) rather than leaving a
selectable option that always fails. The backend adapter itself is
untouched — deliberately not deleted, on the same reasoning as
`WaqfDeed`/`CompliancePolicySet.requiresTrusteeLicense: false`
elsewhere in this file: the code isn't wrong, only unusable under
Birr's current entity, and would become real again if Birr ever
operates through a different legal entity in a Stripe-supported
country. Platform Settings' own Stripe configuration section is left
in place for the same reason.

**Real consequence, not yet resolved:** any Waqf Fund or Vault
denominated in USD, EUR, or GBP now has **no working donation method at
all** — Paystack only accepts NGN today, and the stablecoin gateway only
takes USDC/USDT. Two live fixture vaults in the dev database
("Second Currency Fixture Vault", "Multi Currency Fixture Vault") and
at least one real-shaped one ("Clean Water for Kaduna Communities", a
USD-denominated Project vault) already exercise this gap live. Two
paths forward, neither built yet: (1) Paystack itself supports enabling
USD as a second currency for a Nigeria-based business — this needs a
real application to Paystack plus a Zenith Bank USD domiciliary account
for payouts, i.e. business/paperwork steps, not a code change, before
any adapter work would make sense; (2) simply keep new campaigns to
NGN/stablecoin and treat USD/EUR/GBP giving as unsupported for now. No
decision has been made yet on which path to take — this is flagged
follow-on work, not resolved by this update.

**Update, 2026-09-26 — closes out the "not done here" copy pass flagged
above (2026-09-04).** A 2026-09-26 comprehensive codebase audit went
looking for that flagged gap to verify it was still real, and found it
had already been closed: `apps/web/app/(founder)/portfolio/[id]
/CausesSection.tsx` carries a dated 2026-09-14 comment and now shows
Investment-type funds their own correct copy ("...the corpus itself
stays invested; investment proceeds are what actually reaches each
cause's beneficiaries"), distinct from the Asset/Project wording. The
fix landed ten days before this file was updated to say so — a real gap
in keeping this ledger current, not a functional gap. Noted here so a
future session doesn't re-do already-finished work on the strength of
the stale note above.

**Update, 2026-11-11 — Zakah, a third product alongside Waqf and Vault.**
Zakah is obligatory, goes only to the eight eligible categories (Qur'an
9:60), and Birr receives it as each payer's **agent (wakil)** — not as
trustee and not as its own money — so it has its own tables, ledger and
module (`packages/zakah`, `apps/backend/src/modules/zakah`), never
extending Waqf or Vault ones. Owner's decisions so far:
- **Web first, mobile later.** A public calculator at `/zakah` now; an
  Expo app afterwards, sharing `@birr/zakah` (the pure-TypeScript
  calculation engine) with the web app and backend.
- **Flexible madhhab.** Madhhab rulings are data (`ZakahRuleset`), one
  ruleset per calculation. A ruleset goes live only through the governed
  `zakah.ruleset_approve`: proposed by `mutawalli_officer`, approved by
  `shariah_board_member` **only** (not the Board of Trustees — these are
  Shariah rulings). The bundled four are drafts; the calculator refuses
  a draft. The nisab basis (gold vs silver) is still the Board's open
  decision and moves the threshold roughly tenfold.
- **Metal prices set the nisab, so two people set them.** Governed
  `zakah.metal_price_set`: proposed by `investment_committee`, approved by
  `compliance_officer` **only**. Payers are warned once prices are over 7
  days old and refused a figure after 31.
- **Zakah settles into a separate bank account**, through a Paystack
  subaccount (Platform Settings → `ZAKAH_SUBACCOUNT_CODE`); no zakah
  payment is taken until it's configured. It is booked in zakah's own
  ledger as a **liability (held for recipients)**, never revenue.
- **100% of zakah reaches recipients.** The payer may add the processing
  fee on top; otherwise Birr pays it from operating funds. Never deducted
  from the zakah.
- **Email optional, like Vault**, with the same accepted AML gaps — plus
  one more: the threshold check never adds a person's Vault and zakah
  giving together. Left to Compliance's off-platform review.
- The calculator's wealth figures stay on the payer's device; a payment
  stores only the amount and which ruleset version and prices produced it.

- **Distribution to the eight categories** (`ZakahDistribution`),
  owner's decisions: to verified individuals (`ZakahRecipient`) **and**
  to active, vetted partners (`Counterparty`), who must report back the
  people reached. A Mutawalli Officer proposes; a Shariah board member
  **or** Compliance approves (`zakah.distribution_approve`). Paid by
  **bank transfer from the zakah account, never Paystack payouts**
  (those draw on Birr's main balance), and booked only once a second
  person — Compliance or the Audit Committee — confirms the bank
  reference (`zakah.distribution_mark_paid`). *Al-'amilin* is closed in
  code and by a database CHECK, following the 100%-to-recipients
  decision. Committed zakah can never exceed zakah received (checked
  under a lock).
- **Two-person recipient registration**, owner's decisions: a recipient
  can't be paid until a Shariah board member or Compliance officer
  approves them (`zakah.recipient_approve`), and changing an approved
  recipient's **bank details or categories** needs the same
  (`zakah.recipient_change`); name, phone, the written reason and
  deactivating take effect at once. The approver is never the person who
  registered them or asked for the change, even if someone else proposed
  it. New bank details wait encrypted on the recipient, never in the
  approval request. The database refuses changing an approved
  recipient's bank details or categories except by applying an approved
  change.

- **Refunds** (`ZakahRefund`), owner's decisions: for **mistakes only**
  (paid twice, wrong amount, not authorised by the payer), never a change
  of mind. Compliance proposes; the **Board of Trustees** approves
  (`zakah.refund_approve`, as with Vault refunds). Paid by **bank transfer
  from the zakah account** (never a Paystack refund, which would come out
  of Birr's main balance) and booked only once a second person confirms
  the reference (`zakah.refund_mark_paid`). Only the zakah is refunded,
  never the fee cover. Refunds share the distributions' spending limit
  (`zakah-commitments.ts`), so zakah already committed to recipients
  can't be refunded, and a payment's refunds never exceed its zakah.

- **Zakah al-Fitr** (`ZakahFitrCampaign`), owner's decisions: one sa'
  of the season's staple per person, valued in Naira; a Mutawalli Officer
  drafts each season and a Shariah board member approves
  (`zakah.fitr_campaign_approve`), versioned so a moved Eid can be
  re-approved. Payments close **the day before Eid** (a database CHECK);
  staff may close earlier without a second person. The payer chooses
  **food** (any school) or **cash** (only under an approved **Hanafi**
  ruleset, checked server-side). The server always works the amount out
  as people × the campaign's amount. Fitr goes to **the poor and the
  needy only** (a database CHECK), through both partners and
  individuals.
- **Pools** (`ZakahPool`): zakah on wealth, fitr-food and fitr-cash each
  have their own "held for recipients" ledger account (2000, 2100, 2200)
  and their own spending limit, and never lend to each other; all three
  sit in the one zakah bank account (1000). A row's pool never changes.

- **AML holds** on zakah payments, owner's decisions: a Compliance
  officer **or** a Mutawalli Officer may hold a confirmed payment, with a
  reason (`zakah.payment_hold`); **only Compliance** may release it, alone
  (`zakah.payment_release`), as with Vault. A hold reserves the payment's
  unrefunded zakah out of its pool's spending limit, so it can't be
  distributed; it's **refused once that zakah is already committed to
  recipients** (follow up off-platform, e.g. an NFIU report). A held
  payment can still be refunded; the refund takes over the reservation.
  The payer is never shown a hold (tipping off).

- **Refund emails**: a payer who gave an email is told when their refund
  is approved and when it's paid (amount, account's last four digits,
  bank reference), sent only after the decision commits. A rejection is
  never emailed, and no email says why — Compliance tells the payer.

- **AML review list** (`zakah.structuring_review`; Ops Console → Zakah
  Giving Review), owner's decisions: visible to Compliance, the Audit
  Committee, the Board of Trustees and Mutawalli Officers — deliberately
  **not** Platform Admin, unlike Vault's. Purely observational, like
  Vault's: payers paying close to the NGN threshold into one pool,
  different payers sharing a network, and **giving that spans Vault and
  zakah** (same email with combined NGN totals reaching the threshold, or
  a network both products' givers used under different emails) — the gap
  the threshold check leaves open. Holding a flagged payment is the
  separate Hold action. The agency (wakalah) wording a payer
accepts (`zakah-terms.ts`) is a **draft** that Legal and the Shariah
Supervisory Board must approve before payments open.

**Update, 2026-11-14 — joint waqf: one founder signs for all, each
co-founder adopts the deed.** Families, couples and friends establishing
a Foundation together had no path: they aren't an Institution, and the
one-per-Foundation deed (see the Foundation Deed note above) was signed
by whoever signed first, so another co-founder's money was dedicated on
someone else's signature with no record they agreed. Owner's decisions
("A2" in the Board note *Joint Waqf: Who Signs the Deed*):
- A third founder type, **"Jointly, with family or friends"**: recorded
  as an individual founder on a Foundation with `establishedJointly`. An
  informal group is never an institution — establishing or joining a
  joint Foundation as one is refused.
- The deed then uses a **joint variant**
  (`JOINT_FOUNDATION_DEED_TEMPLATE_VERSION`): the first founder signs for
  themselves and every co-founder, present and future, and the deed
  lists the co-founders as of signing. It also applies when a
  single-founder Foundation has gained a co-founder before signing.
  Single-founder deeds are byte-identical to v1.
- **Every co-founder accepts a statement when accepting their
  invitation** (`co-founder-consent.ts`): authorizing the signer if the
  deed isn't signed yet, adopting it if it is. Stored as an immutable
  `CoFounderDeedConsent` with the exact text and version, plus an audit
  row; acceptance is refused without the current version, or if the
  statement changed since it was shown (e.g. the deed was signed while
  they read: the client echoes the statement's hash).
- The signing page now shows **the full deed text** that will be
  stored (`GET /foundation-deeds/:foundationId/preview`), not only a
  summary, and signing is refused if the text changed since it was shown.
  Funds and co-founders are listed oldest first, so the hashed text is
  the same on every read.
- **Went live at the owner's direction before Legal or the Shariah
  Supervisory Board reviewed the joint wording or the statements** — the
  Board note asks them to. A revision they approve gets a new version.
- **2026-11-16, owner's decision: a joint deed waits for every
  co-founder's own agreement.** Signing is refused while any other
  founder of the Foundation has no `CoFounderDeedConsent`; the signing
  page names who it's waiting for, and reminds each one's primary
  contact by email and WhatsApp (`foundation_deed.consent_needed`, at
  most once a day per Foundation). Co-founders without one (joined
  before agreeing was part of joining, or added another way) agree on
  the Foundation's deed page (`GET/POST
  /foundation-deeds/:foundationId/consent`, their primary contact only),
  and can adopt a deed already signed the same way. Signing and joining
  both take the Foundation's row lock first, so neither sees the other
  half-done. `co_founder_deed_consents` has founder-isolation RLS like
  `foundation_deeds`.

**Update, 2026-11-15 — Stablecoin hidden as a donation option too; no
crypto for now.** Owner's decision, after research showed neither works
in Nigeria today:
- **The gateway is gone.** `StablecoinAdapter` is built on Coinbase
  Commerce, which reportedly closed to merchants outside the US and
  Singapore on 2026-03-31; its successor, Coinbase Business, serves
  US/Singapore entities only. No key was ever configured and no
  stablecoin payment was ever made.
- **The law doesn't allow it yet.** The CBN's Regulations for the
  Operations of Non-Security Virtual Assets (in force 2026-11-05) let a
  dollar stablecoin be used in Nigeria only once approved as "Class 2"
  and issued by a CBN-licensed Nigerian company; none is reported
  approved, so USDC/USDT don't qualify. Merchant acceptance and payment
  gateways need separate CBN authorisation; existing operators have 180
  days (to about early May 2027) to apply. The SEC (ISA 2025) already
  barred accepting crypto directly without registration.
- **Other crypto (BTC, ETH, ...) waits on three things**, revisit after
  the CBN window closes: a legal opinion on whether a non-profit
  receiving crypto through an authorised gateway needs its own approval;
  a Shariah Supervisory Board ruling on crypto as waqf or zakah (AAOIFI
  has no binding standard, and scholars differ); and a CBN-authorised
  provider that converts to naira on arrival, so a waqf never holds a
  volatile asset.
- Removed from `WaqfFundForm.tsx` and `vaults/[slug]/page.tsx`, the
  same way Stripe was; the adapter, webhook and Platform Settings entry
  stay. Most findings came from news and law-firm summaries, not the
  CBN text itself; have Legal confirm before relying on them.
- For USD giving, the route is still Paystack international payments
  with a Zenith Bank USD domiciliary account (see the 2026-09-19 note).

**Update, 2026-11-15 — monthly giving, in naira.** Owner's decisions:
- **Birr charges a saved card each month** (`RecurringGift`,
  `modules/recurring-gifts`), for Vault gifts, founders' Waqf Fund
  top-ups and zakah on wealth. The first gift is a card-only Paystack
  checkout that saves the card's reusable authorisation (encrypted);
  each later month goes through the product's own `initiate()` and
  Paystack `charge_authorization`, so it passes every check a one-off
  gift does. Not Paystack Subscriptions, which would charge without
  those checks. Only cards can repeat.
- **Monthly zakah is paid in advance (ta'jil)**, zakah on wealth only,
  **live before the Shariah Supervisory Board has ruled**; the form says
  the Maliki school doesn't permit paying zakah early. Each charge
  records the setup's ruleset and prices; a changed wakalah wording
  pauses it until the payer accepts the new one. Zakah al-Fitr stays
  one-off. Add this to the Board's review list.
- **Vault and zakah givers manage a gift through a private emailed
  link** (only its hash is stored; `/giving/manage` reissues links), so
  monthly giving needs an email. Founders manage top-ups in the Founder
  Portal, under their account email; top-ups start only after a fund's
  first contribution.
- **The database allows one non-failed payment per gift per month**
  (partial unique index), NGN only, day 1–28, never active without a
  card. Declines are retried after 1 and 3 days, then the gift pauses.
- **A scheduled charge accepts an ID already on file** past the AML
  threshold (no one is present to re-type it, and the charge isn't
  someone typing an email); without one, the gift pauses for the giver
  to add it.
- **Ops Console → Monthly Giving**: `giving.monthly_view` (Compliance,
  Audit Committee, Board, Mutawalli Officers; not platform_admin);
  `giving.monthly_cancel` is Compliance alone with a reason, never shown
  to the giver.
- Verified end to end on 2026-11-15 with Paystack test mode: a Vault
  gift's setup checkout, then a real `charge_authorization` for the next
  month. Founder top-ups and monthly zakah are covered by tests, not yet
  by a live test-mode run.

**Update, 2026-11-15 — the audit log now refuses rewrites at the database
level.** Its four actor foreign keys (user, founder, AI agent, Vault
donor) were `ON DELETE SET NULL`, so deleting one of those people
rewrote every audit row naming them, with the table owner's rights,
around the revoked UPDATE grant, and broke those rows' hashes. 5,941 rows
in the dev database failed `audit_logs_verify_chain()`, all from test
cleanup; no application code deletes these people. Owner's decision:
those keys are now `RESTRICT`, and triggers refuse any UPDATE, DELETE or
TRUNCATE on `audit_logs`, whoever runs it
(`20261115190000_audit_logs_refuse_rewrites`). Tests leave people the
log names in place. The dev rows already broken can't be repaired (their
original values are gone) and stay flagged; a fresh database's chain
verifies clean. A future migration that must touch audit rows has to drop
those triggers explicitly.

**Update, 2026-11-15 — staff can be suspended and reinstated.** Owner's
decision: the governed `staff.suspend` / `staff.reinstate`, the same
two-person rule as role changes (maker `platform_admin`; checkers
`board_of_trustees` / `compliance_officer`), with a written reason kept
in the audit trail. Nobody proposes or approves their own. A suspension
is refused if it would leave any governed action with nobody active able
to propose or approve it, or remove the last active `platform_admin`
(`assertSuspensionAllowed`, re-checked at approval under a lock). It
takes effect on the person's next request, since
`resolveBirrStaffFromSession` refuses anyone not active; their open
proposals stay for others to decide. One pending role or status change
per person at a time.

**Update, 2026-11-15 — daily Paystack reconciliation, flag-only.**
Owner's decisions: each Lagos day is checked against Paystack in **both
directions** — money in (waqf contributions, Vault gifts, zakah with its
fee cover, monthly charges included), money out (Paystack transfers for
waqf and Vault distributions) and Vault refunds — and every mismatch is
**flagged for Compliance; nothing is corrected automatically**
(`modules/payment-reconciliation`). Zakah distributions and refunds are
bank transfers from the zakah account, so they're outside it. The
scheduler reconciles yesterday after 02:00 Lagos; Paystack is read ±1
day so midnight-straddling payments aren't reported missing. Compliance
is notified (in-app and email), can "ask Paystack again" through each
product's own re-check, and resolves with a required note (a database
CHECK). `payments.reconciliation_view`: Compliance, Audit, Board,
Mutawalli; `_resolve` and `_run`: Compliance. In a dev database, test
fixtures with references Paystack never saw are flagged, correctly.

**Update, 2026-11-15 — a Founder's primary contact can be replaced,
two-person.** Answers the open question in
`docs/succession-and-preservation.md` (2026-08-30). Owner's decisions:
- **The contact can still act** (retiring, a new Bursar, leadership
  changing): they ask on the Team page; Birr confirms. After it, they
  stay a viewer. If the successor is new to Birr, they're invited, and
  the outgoing contact keeps the role until the invitation is accepted.
- **The contact is gone** (died, incapacitated, unreachable): another
  member asks, or a Mutawalli Officer records it for family or an
  institution, with the evidence seen (a database CHECK requires it).
  The contact is emailed and sent a WhatsApp at once and has **7 days to
  object**; an objection blocks approval until staff close the case.
  Approval revokes the outgoing contact's access.
- **Both end in the governed `founder.primary_contact_change`**: maker
  `mutawalli_officer`, checkers `compliance_officer` / `board_of_trustees`.
  `PrimaryContactSuccession` keeps each case
  (`modules/founder-succession`); Ops Console → Primary Contact Changes;
  runbook `docs/founder-succession.md`.
- The database allows **one active primary contact and one open case per
  Founder** (partial unique indexes). The primary contact role can no
  longer be given by an ordinary team invitation. Every primary-contact
  lookup now also requires the membership to be active.
- Birr transferring trusteeship itself stays out of scope (going-concern
  decision, 2026-08-30).
- **2026-11-16, owner's decisions:** the 7-day notice is confirmed. The
  notice must work without signing in: it gives Birr's contact email and
  phone (Platform Settings → `support`, also the email's reply-to), its
  email never says it can be ignored, and staff record an objection made
  by phone or email ("Objection received…"). The wording
  (`succession-notice.ts`) is a **draft** that Legal must approve; its
  version is in the audit row.

**Update, 2026-11-16 — no production hosting for now.** The Render
services are suspended and the free Render database expired (30-day
limit), so nothing is running. Owner's decision: keep developing
locally and choose hosting closer to launch (Render paid plans, or the
HarmonWeb VPS in `docs/vps-deployment-plan.md`). Whatever is chosen must
be always on: the backend's scheduled jobs (monthly charges and retries,
the daily Paystack reconciliation, licence checks) can't run on a
sleeping instance. The CI `deploy` job is paused until the repository
variable `DEPLOY_ENABLED` is `true`. Steps for that first deploy:
`docs/deploy-checklist-2026-11.md`.

**Update, 2026-11-16 — givers can use WhatsApp instead of email.** Owner's
decisions:
- **Where:** one-off zakah and Vault gifts (receipts; zakah refund
  notices), monthly zakah and Vault gifts (receipts, reminders and the
  private manage link), and founder Waqf top-up notices (also sent to the
  founder's verified account number).
- **Always confirmed first:** a 6-digit WhatsApp code
  (`GiverWhatsAppService`; `POST /giving/whatsapp/code` and `/confirm`),
  rationed per number and per IP. Confirming returns a short-lived proof
  that every giving route checks, so an unconfirmed number is never used.
- **It counts for AML:** gifts sharing an email *or* a confirmed number add
  up toward the threshold (`findOrCreateDonor`, `findOrCreatePayer`). This
  narrows the "different email each time" gap accepted on 2026-09-15; it
  doesn't close it (a different number each time still splits giving).
- `ZakahPayer`, `VaultDonor` and `RecurringGift` take an email, a
  `whatsappNumber`, or both (a CHECK requires one). Paystack still needs
  an email: a WhatsApp-only monthly gift uses a stand-in worked out from
  its id (`paystackEmailForGift`), the same every month, since a saved
  card is charged under the email it was saved with.
- **Receipts go to the contacts given with that payment**
  (`contactEmail`/`contactWhatsApp` on `VaultContribution` and
  `ZakahPayment`), never to the giver record (review fix, 2026-11-16).
  A giver record never gains an email or number from a later gift, since
  anyone can type an email: pairing someone else's email with your own
  number must not redirect their receipts. Records sharing an email or
  number still add up for the threshold, and an ID on any of them must be
  re-entered and match. A founder's top-up WhatsApp honours their "money"
  notification setting. A ruleset's "lower of" nisab is recorded as the
  metal it came to that day.
- **Templates (built 2026-11-16):** a production sender can only start a
  conversation with a Meta-approved template. Every WhatsApp Birr sends
  goes through one of six templates (`whatsapp-templates.ts`: verification
  code, gift receipt, zakah receipt, zakah refund update, monthly gift
  update, account notice), sent by `TwilioWhatsAppAdapter.sendTemplate`
  once its content SID is in Platform Settings → Twilio. Without one, the
  sandbox sender sends the old free text, and a real sender refuses and
  logs rather than send what WhatsApp would reject. **Still to do before
  launch:** Meta business verification, then submit and approve the
  templates per `docs/whatsapp-templates.md` (a test keeps it matching
  the code) and paste in their SIDs.

**Update, 2026-11-16 — the payer chooses a gold or silver nisab, where the
Board allows it.** Owner's decisions: each ruleset carries
`payerChoosesNisab`, set by the Shariah Supervisory Board through the
usual `zakah.ruleset_approve` (the bundled drafts propose allowing it;
rulesets approved before this read as fixed). Where allowed, the
calculator shows a Gold / Silver switch with today's nisab for each,
**silver by default** (`PAYER_DEFAULT_NISAB_BASIS`), and the ruleset's own
`nisabBasis` isn't used; where not, the fixed basis applies and a choice is
refused. The basis a figure used is recorded on `ZakahPayment.nisabBasis`
and, for monthly zakah, `RecurringGift.zakahNisabBasis`, reused for each
later charge. This replaces "nisab basis is still the Board's open
decision": the Board now decides whether payers choose, not which metal.

**Update, 2026-11-16 — changing a cause allocation is guided, and can't
undo money already committed.** Allocation stays founder self-service
(2026-08-27); owner's decisions on changing one that's already set:
- **A review before it's saved**: now → new, what that leaves
  unallocated, and what's already committed to the cause. A first
  allocation saves directly.
- **Move** (`POST /waqf-causes/:id/move`) takes from one cause and adds
  to another of the same fund in one step; the fund's total is unchanged.
- **A written reason** for lowering, moving, or removing a cause that has
  an allocation, kept in the audit row (`changeReason`). The fund's
  assigned Mutawalli Officer (else every active one) gets an in-app
  notice; it blocks nothing. Removing such a cause also needs the primary
  contact now, like allocating.
- **A gap this closed (Asset/Project funds):** a founder could lower a
  cause's allocation below what was already committed to it (pending,
  approved, disbursing or paid distributions), or remove the cause, and
  allocate the freed money to another cause, so the causes together could
  have more committed than was raised. Now an allocation can't go below
  what's committed, a removed cause's committed money stays out of
  "unallocated" (`WaqfCausesService.allocationPosition`, also behind
  `GET /waqf-causes/allocation-summary`), and a removed cause takes no new
  distributions (`DistributionsService.create`). Investment funds are
  untouched: their corpus allocation is a target, not what's spent.
- Allocation now locks the cause before the fund (`FOR NO KEY UPDATE`),
  the same order distributions use, so the two can't both pass on stale
  figures.

**Update, 2026-11-16 — founders choose their top-up amount; Vault gifts
have their own minimum.** Owner's decisions:
- **A founder decides how much to top up**, monthly or one-off, above a
  small staff-set floor: `ContributionMinimum` ("Minimum top-up per
  currency", Ops → Waqf Funding), now seeded at **₦5,000** (it had been
  raised to ₦250,000). A fund's first payment is still set by its corpus,
  and the ₦250,000 to establish one is `CorpusMinimum`, unchanged.
- **Paying exactly what's left to reach the declared target is always
  allowed**, even below the floor (`ContributionsService
  .isExactlyTheRest`), so an installment plan can always be finished; the
  top-up page offers "Pay the ₦X left". One-off only: a monthly top-up
  repeats.
- **Vault gifts have their own minimum**, `VaultGiftMinimum` (Ops →
  Vaults, `vault.gift_minimum_set`, Mutawalli Officer), starting at
  ₦5,000. Until then they silently shared the Waqf floor, so the ₦250,000
  meant no one could give a Vault less. The migration copied every
  currency's existing value; the seed never overwrites a staff-set one.

**Update, 2026-11-16 — Roles & Access rebuilt for production.** Owner's
decisions, after reviewing the Ops Console page:
- **Changes are batched, with a reason.** A platform admin stages edits
  in place (each control starts from the current grant), sees every
  change with the guard rails already run (`POST
  /roles/permission-changes/preview`) and how many people it affects, and
  sends them as one `role.permission_change` with a required reason. The
  Board approves or rejects the set; one `role_permission.changed` audit
  row per change carries the reason, proposer and approver. Lock-outs are
  judged on the batch's combined end state. Proposals from before
  (one change, no reason) still decide.
- **Staff managers only:** `roles.view` (platform_admin, Board,
  Compliance, Audit Committee) gates the page and every `/roles` route.
- **Shows** who holds each role, every permission (including ones no
  role holds, which previously vanished from the UI for good), changes
  awaiting the Board and the history, and a dated CSV export of the full
  matrix (`roles.matrix_exported` audit row).
- **Access review every 90 days:** a Board member (`roles.access_review`)
  confirms each role or notes what needs changing (`AccessReview`,
  insert-only by trigger, with a hashed snapshot of every grant). It
  changes nothing itself. The Board is reminded in-app when it's due, at
  most weekly (`access-review-scheduler.ts`). Test reviews from the spec
  stay in a dev database, since the table can't be deleted from.

**Update, 2026-11-16 — jurisdiction is a country code, picked from a
list.** Owner's decision, after the counterparty form accepted "Nigeria"
as free text. That doesn't match the `NG` compliance policy or trustee
licence looked up by jurisdiction, and 4 funds and 1 foundation already
said "Nigeria".
- Every jurisdiction (Waqf Fund, Foundation, counterparty, vault, trustee
  licence, compliance policy, and a founder's home jurisdiction) is a
  two-letter ISO 3166-1 code.
- **Picked:** from a searchable country list in the app (`CountrySelect`,
  "Nigeria (NG)").
- **Checked:** by `@CountryCode()` / `ParseCountryCodePipe` in the API.
- **Enforced:** by a database CHECK (`^[A-Z]{2}$`).
- **Shown:** as the country's name.
- **Converted:** existing names, by migration
  `20261117000000_jurisdiction_country_codes`, which stops rather than
  guess at anything it can't map.
- **Where the list lives:** the new pure-TS package `@birr/shared` (built
  like `@birr/zakah`), shared by the backend and web.
- **Tests:** they use ISO's user-assigned codes (`XA`–`XZ`), which are
  never a real country.

**Update, 2026-11-16 — every form field is checked.** Owner's decision,
after the counterparty form accepted anything (a blank name, `bob@` as
an email, "call me" as a phone):
- **One set of rules** in `common/validation/fields.ts`: `TextField`,
  `LongTextField`, `NameField` (needs a letter), `EmailField`,
  `PhoneField` (stored as E.164; a leading 0 is Nigerian, so `0803…`
  becomes `+234803…`), `UrlField` (http/https), `DateField`, `IdField`,
  `SecretField`, `JsonObjectField`, and `Trimmed` for fields that keep
  their own length and minimum rules. Every API input uses them.
- **Text is trimmed, and blank counts as not given:** a required field
  says "X is required"; an optional one is left out (so on an update,
  `""` now means "no change", not "clear it"). Ids, passwords, tokens
  and WhatsApp proofs are never changed. Emails aren't lower-cased
  (accounts are looked up as stored).
- **Plain errors:** `createValidationPipe()` (`main.ts`) words each one
  for the form ("Contact email must be a valid email address…"), and
  refuses unknown fields by name.
- **Limits are shared:** `FIELD_LIMITS` in `@birr/shared`. The web's
  `Input` gets a default `maxLength` from its type, every textarea has
  its field's limit, and fields have the right type (email, url, tel).
- **Guard test:** `dto-coverage.spec.ts` fails on any text field in an
  API input that has no length limit or rule, or free text that isn't
  trimmed, the same idea as `route-role-coverage.spec.ts`.
- **Forms check as you type, too** (same day, after the owner typed a
  24-digit phone, a licence number of "adewale" and an authority of
  "345666"): `@birr/ui` `Input` checks phone (`type="tel"`: phone
  characters only, at most 20), email and url inputs on its own, and
  `check="name"` (needs letters) / `check="reference"` (needs a digit)
  where a page asks. The message shows once the person leaves the field,
  and the browser won't submit while it's wrong. The rules are
  `fieldProblem` in `@birr/shared`; the API has the matching
  `ReferenceField` (registration and licence numbers) and `NameField`
  (licensing and regulating authorities).
- **Every form, 2026-11-17:** every name box (people, organisations,
  funds, causes, banks, account names) has `check="name"`, and every ID
  or bank reference has `check="reference"`, Founder Portal, Ops and
  giving alike. The founder setup forms' plain `<input>`s became `Input`
  so they're checked too. Fields keeping their own limits on the API get
  `HasLetters()` / `HasDigits()` beside them (giver identities, zakah
  recipients and refunds, nominations, cause categories, blog authors).

**Update, 2026-11-17 — security review before launch**
(`docs/security-review-2026-11-17.md`). Fixed first:
- **Two-factor could be skipped** with a password alone: the "now enter
  your code" token was accepted as a session. A full session token is now
  marked `purpose: "session"` and only those are accepted
  (`common/auth/session.ts`). Never sign another token type that a
  session check could mistake for a session.
- **Staff see a founder or co-founder invitation's link only if they sent
  it** (`redactInvitationTokenFor`): a link lets its holder set the
  account's password, so any staff role could have joined a Foundation as
  someone else.
- **`TRUST_PROXY_HOPS`** must be set to the number of proxies in front of
  the API (1 for Render or nginx), or every visitor shares one IP for rate
  limits, WhatsApp code limits, the AML network review and deed evidence.
  Never higher than the real number.
- **Hardening (second PR):** security headers on every web page (no
  framing, `next.config.mjs`); `users.sessionsValidFrom` ends every older
  session on a password reset or any two-factor reset; reset and
  verification tokens are stored only as a SHA-256 hash (`hashToken`); a
  two-factor code signs in once (`users.mfaLastUsedStep`) and a backup code
  is claimed in one write (`claimSignInCode`).

**Update, 2026-11-16 — every scheduled job is watched, and backups are
real.** The five scheduled jobs (monthly giving, Paystack reconciliation,
portfolio drift, trustee-licence expiry, access-review reminders) used to
only log their failures. Each tick now goes through `runMonitoredJob`
(`common/jobs/job-monitor.ts`):
- every run is recorded in `job_runs`;
- a failure goes to Sentry and to platform admins' bell (at most every 6h
  per job), and never throws;
- a job is overdue when it hasn't succeeded within twice its interval plus
  slack.

Where it shows:
- Ops → System health (`system.health_view`, platform_admin);
- `GET /health/jobs` (503 naming overdue or failing jobs; for an external
  uptime monitor). `GET /health` stays the liveness check.

Backups:
- `scripts/backup-postgres.sh` (daily cron): `pg_dump`, GPG-encrypted to
  a public key the server can't decrypt with, checksummed, an optional
  rclone off-site copy, and it records its own run (job
  `database_backup`).
- `scripts/restore-check.sh` (monthly drill) restores into a scratch
  database and verifies the checksum, the audit hash chain and core
  tables.
- Both were verified on the dev database.
- Setup and runbook: `docs/monitoring-and-recovery.md`. None of it is
  live until the deploy sets it up.

**Update, 2026-11-16 — Team page rebuilt to the Roles & Access standard.**
Every staff change now needs a written reason (10–1,000 characters) shown
to the approver and kept in the audit row: inviting, adding or removing a
role, and resetting two-factor (suspend/reinstate already did). Proposals
from before still decide. Changes are proposed from a person's panel with
a confirm step naming the effect; nothing is one click any more (the old ×
on a role proposed a removal at once). The roster marks what's awaiting
approval (`GET /birr-staff/pending-changes`) and blocks further changes for
that person until it's decided, shows two-factor status and **last
sign-in** (`User.lastSignInAt`, set when a staff session is issued), and
flags accounts with no sign-in for 90 days — flagged only, never suspended
automatically. Staff managers (`roles.view`) see each person's history
(`GET /birr-staff/:id/history`). The roster defaults to active staff.

**Update, 2026-11-16 — re-running the seed never undoes what staff have
set.** It used to: every run put the contribution and corpus minimums,
the Vault AML donor thresholds, the cause catalog, the Shariah-prohibited
sectors and ledger account names back to `seed-data.ts`, reset the
bootstrap admin's password (lifting a suspension), and reset AI agent
keys (switching a disabled agent back on). Now all of those are
create-only (ledger account type and system-default flag still follow
the code). Outside a local dev database the bootstrap admin and the
agents are left exactly as they are; the local dev logins still reset,
so their documented passwords keep working. Verified by seeding a
scratch database as production, changing each value as staff would, and
seeding again.

**Update, 2026-11-17 — the Mother & Child Clinic, a fourth product, and
its first slice.** Owner's decisions (plan:
https://claude.ai/artifact/54WMUrmrsk7kL17AjAa5GC):
- **What it is:** a laboratory and mini clinic in Ibadan for women and
  young children only, sold as one bundle and held in **one clinic waqf
  that Birr establishes and curates** (not Founders' own funds owning
  parts). Its own module when built, never extending Waqf or Vault tables.
- **Two pots:** an endowment (kept: premises, equipment, invested cash)
  and a running fund (spent). Founders (with an account, from ₦250,000)
  and the public (no account, from ₦5,000) choose to endow or give. Zakah
  only pays poor or needy patients' bills, never the endowment.
- **A licensed operator runs it** under contract; Birr never practises
  medicine. Patient records stay with the operator: Birr sees counts and
  anonymous claim lines only.
- **Premises by whatever suits the site:** land donated or bought and
  built on, or a building donated or bought and renovated. Donation is
  possible, never required. No deliveries at first.

Slice 1, healthcare operator vetting (built):
- **New type and table:** `CounterpartyType.healthcare_provider` and
  `CounterpartyLicense`.
- **Two people per licence:** one records it
  (`counterparty.license_record`: Mutawalli, Compliance); a different
  person verifies it against the certificate or register
  (`counterparty.license_verify`: Compliance; a CHECK refuses the
  recorder). Compliance withdraws one at once
  (`counterparty.license_withdraw`).
- **History is kept:** what the certificate says never changes, and no
  licence is ever deleted (triggers). A renewal is a new row.
- **Payment gate:** a healthcare provider can't be onboarded or paid
  unless all four `REQUIRED_COUNTERPARTY_LICENSES` (`@birr/shared`:
  facility, MLSCN, malpractice insurance, NDPC) are verified and in date
  (Lagos dates). The check runs in `onboard()` and in Vault and zakah
  distributions, at creation and again at approval. It share-locks the
  counterparty, which verify and withdraw lock for update. Other
  counterparty types are unaffected.
- **Expiry warnings:** whoever can verify is warned 60, 30 and 7 days
  before expiry and once lapsed, each sent once (job
  `counterparty_license_expiry`).
- **Still investment_committee only:** `counterparty.register`, so
  registering a clinic operator needs that role or a Roles & Access
  change.

Slice 2, the clinic waqf itself (built, `modules/clinic-waqfs`):
- **`ClinicWaqf`:** created as a draft by a Mutawalli Officer
  (`clinic_waqf.manage`). It's established only by the governed
  `clinic_waqf.establish` (checker: Board of Trustees only), and only
  once a deed version is approved. Once established it can't be
  un-established or deleted, and its web address never changes
  (triggers).
- **`ClinicWaqfDeed`, versioned:** a Mutawalli Officer drafts a version
  (the standard wording, `clinic-waqf-deed.ts`, is a **draft** for Legal
  and the Shariah Supervisory Board). The governed
  `clinic_waqf.deed_approve` (checker: Shariah board member only) names
  the text's hash, and approving it supersedes the previous version. A
  version's wording never changes; the database recomputes its sha256.
  At most one approved version and one open draft per clinic.
- **Ledger (`ClinicLedgerService`):** every account belongs to the
  endowment or the running fund. At commit, the database refuses any
  entry that doesn't balance within each pot, so money never moves
  between them. The endowment's income is booked straight into the
  running fund (4100). Append-only.
- **Ops Console:** Clinic Waqfs (list, create, deed versions, both
  proposals, the ledger by pot). Gifts come in slice 3.

Slice 3, one-off public gifts (built, `ClinicGift`,
`ClinicGiftsService`). Owner's decisions:
- **Own subaccount:** a gift settles into the clinic waqf's own Paystack
  subaccount (Platform Settings → `CLINIC_WAQF_SUBACCOUNT_CODE`), never
  Birr's main balance. No gift is taken until it's set.
- **Fee:** the giver may add the processing fee on top (kept by the main
  account); otherwise Birr pays it. The full gift reaches its pot.

How it works:
- **Choosing a pot:** a giver (no account, from ₦5,000) picks the
  endowment or the running fund on `/clinics/:slug`. An endowment gift
  accepts the approved deed; its id and hash are stored, and the database
  refuses one that doesn't match. Paystack returns them to
  `/clinic-gifts/:id`.
- **Confirming:** once, from the webhook (in the shared chain, before
  zakah) or the giver's return. The gift is then posted to its pot:
  1000/3000 for the endowment, 1100/4000 for the running fund. Receipts
  go to the contacts given with the gift.
- **AML:** the giver is a `VaultDonor`, so Vault and clinic gifts by the
  same email or confirmed number count together toward the ID threshold
  (`VaultContributionsService.findOrCreateDonor`, now shared). The
  structuring review lists don't include clinic gifts yet.
- **Reconciliation:** daily Paystack reconciliation includes clinic gifts
  (`clinic_gift`).
- **Kept as given:** what was given, the pot and the deed never change; a
  gift settles once and is never deleted (triggers).

Slice 4a, Founders giving to a clinic (built). Owner's decisions:
- **Verify, then give.** Someone who signs up from a clinic page verifies
  their email and WhatsApp like every Founder, then becomes a Founder
  **without a Foundation**:
  - `Founder.clinicSupporter`, created by `POST /founders/clinic-supporter`;
  - the onboarding step 2 page offers this when they came from a clinic
    (`lib/return-to.ts`);
  - their onboarding is then complete (`clinicSupporterOnly`), and they
    can set up a Foundation later.
- **Minimum:** a Founder's first gift to a clinic is at least ₦250,000;
  later gifts from ₦5,000.

How it works:
- **Giving:** a signed-in Founder's primary contact gives as the Founder
  (`POST /clinic-gifts/founder`, `assertFounderVerified`). The gift
  records `founderId` and `initiatedByUserId`, with no `VaultDonor`: a
  CHECK refuses both, and there is no AML ID threshold, as for Waqf Fund
  contributions. The receipt goes to their account.
- **Seeing it:** Founder Portal → Clinic support shows totals per clinic
  and pot, and every gift. It is also the home page of a clinic-only
  Founder.
- **AML review:** the Vault structuring review and zakah's cross-product
  review now list public clinic gifts, named "(clinic waqf)". Founders'
  gifts aren't listed.
- **Next:** monthly clinic giving is slice 4b.

Slice 4b, monthly clinic giving (built). Owner's decision: **both pots**.
A monthly endowment gift keeps the deed version its giver accepted, and
**pauses (`terms_changed`) once a newer version is approved**, until they
accept it.
- **The product:** `RecurringGiftKind.clinic`, charged by
  `ClinicMonthlyProduct` through `ClinicGiftsService`, so every month
  passes the same checks as a one-off gift. A public giver's month goes
  through the shared AML threshold. A Founder's month is given as the
  Founder, by whoever is their primary contact then.
  - `RecurringGift.clinicWaqfId`, `clinicPot`, `clinicDeedId` and
    `clinicDeedTextHash` hold what it gives to, checked by the database.
  - `ClinicGift.recurringGiftId` and `recurringPeriod`: at most one
    charge per gift per month.
- **A Founder's gift, not a Waqf top-up:** "a Founder's own gift" is now
  `founderId` set (`isFounderGift`), not `kind === "waqf"`. That covers
  the private link, emails, audit and who cancelled. A Founder's clinic
  monthly gift has no private link; they manage it on Clinic support
  (`/clinic-gifts/founder/monthly/...`).
- **Accepting a new deed:** a public giver does it from their manage link
  (`POST /giving/manage/:token/deed`); a Founder from Clinic support.
  Only the current approved version is accepted, as shown.
- **Fixed along the way:** `RecurringGiftsService.settleCardCheckouts`
  used to stop the whole scheduler run at the first gift that threw. Each
  gift is now settled on its own, as charging already was.

Slice 5a, the asset register (built, `ClinicAsset`,
`ClinicAssetsService`):
- **Gifts in kind:** a Mutawalli Officer records land, a building or
  equipment given in kind, at its independent valuation (and title, for
  land). The governed `clinic_waqf.asset_add` (checker: Board of Trustees)
  adds it to the endowment, booking 1500/3000. Only an established clinic
  waqf can take one.
- **Disposal:** `clinic_waqf.asset_dispose` (checker: the Board). The
  asset leaves at its booked value, proceeds go to endowment cash, and
  the difference comes off endowment capital, all within the endowment.
  Whether disposing of land or a building (istibdal) also needs the
  Shariah Supervisory Board is still their open question.
- **Rules:** what an asset is and its value never change (a trigger);
  care details (room, serial, warranty, service dates) stay editable and
  audited. Never deleted.
- **Next:** buying equipment with endowment cash, and building work paid
  by stage, come with endowment spending (slice 5b).

Slice 5b, endowment spending (built, `ClinicWorksProject`, `ClinicSpend`,
`ClinicSpendingService`). Endowment cash becomes the endowment's own
premises and equipment (1500/1000), so it stays in the endowment.
- **Works projects:** a Mutawalli Officer proposes the route, contractor
  (an active Counterparty) and the quantity surveyor's budget; the Board
  approves (`clinic_waqf.works_approve`).
- **Payments:** a payment is equipment (invoice) or a works stage (the
  engineer's certificate, to the project's own contractor).
  - Approval: the Board **or** Compliance (`clinic_waqf.spend_approve`).
  - Paying: by bank transfer from the clinic waqf's account, never a
    Paystack payout.
  - Booking: only once Compliance **or** the Audit Committee confirms the
    bank reference (`clinic_waqf.spend_mark_paid`). Paid equipment joins
    the asset register at cost (`acquisition: purchased`).
- **Limits, under the clinic row lock:** proposed and approved payments
  never exceed the endowment's cash (1000), and a project's stages never
  exceed its budget.
- **Database:** what a payment or project is never changes; status only
  moves forward; never deleted.

Slice 5c, investments (built, `ClinicInvestment`, `ClinicInvestmentIncome`,
`ClinicInvestmentsService`). The principal stays in the endowment (1200);
only the income is spent, booked straight into the running fund
(1100/4100).
- **Recording and screening:** the Investment Committee records an
  investment (`clinic_waqf.investment_manage`). A Shariah board member
  screens it (`clinic_waqf.investment_shariah_screen`), never whoever
  recorded it (a CHECK).
- **Placing:** an endowment payment of kind `investment`, through the
  slice 5b approve, pay and confirm flow, which books 1200/1000. The
  Investment Committee may propose those payments.
- **Income and return:** income is recorded by the Investment Committee
  or a Mutawalli Officer (append-only, only once placed). The principal
  coming back is recorded by the Investment Committee (1000/1200).

Slice 6, price list and subsidy bands (built, `ClinicPriceList`,
`ClinicPriceListsService`). Versioned like the deed: each version is
canonical JSON (services with code and price, bands with who qualifies and
the patient's share, the running fund's monthly subsidy cap), with its
sha256 checked by the database.
- **Drafting:** a Mutawalli Officer (`clinic_waqf.manage`), one draft at a
  time.
- **Approving:** the Board **or** Compliance
  (`clinic_waqf.price_list_approve`), naming the content's hash; approving
  supersedes the previous version.
- **Database:** content never changes; status moves draft → approved or
  discarded, approved → superseded; never deleted; one approved and one
  draft per clinic.
- Monthly claims (slice 7) are checked against the approved version.

Slice 7, operator and monthly claims (built, `ClinicClaim`,
`ClinicClaimLine`, `ClinicClaimsService`). Patient records stay with the
operator: a line is a visit reference, the service and band, what the
patient paid, and whether the operator assessed her as poor or needy.
- **Operator:** a licensed, active `healthcare_provider`, assigned by the
  Board (`clinic_waqf.operator_assign`).
- **Checks on upload** (a Mutawalli Officer, `clinic_waqf.manage`):
  - the service is on the approved price list, at its price;
  - the patient paid **exactly** the band's share, rounded to the kobo:
    never more from her, never more from the fund;
  - the visit is in the claim's month;
  - a visit's service is claimed only once, ever;
  - one live claim per clinic per month (a database index);
  - the running fund part is within the list's monthly cap.
  - Every failing line is reported at once.
- **The split:** subsidies for poor or needy patients are the zakah part;
  the rest is the running fund part.
- **Running fund part:** the Board or Compliance approves
  (`clinic_waqf.claim_approve`). It must fit in the running fund's cash
  (1100) less approved, unpaid claims. It's paid by bank transfer, and
  Compliance or the Audit Committee confirms the reference
  (`clinic_waqf.claim_mark_paid`, 5000 / 1100).
- **Zakah part:** paid as an ordinary zakah distribution to the operator
  (zakah on wealth, poor or needy, the exact amount), with zakah's own
  approvals, then linked to the claim once.
- **Tamlik, owner's decision 2026-11-17** (plan question 1): the
  patient's written authorisation is enough. A patient assessed as poor
  or needy authorises Birr in writing to pay her bill to the clinic for
  her, so zakah is paid to the operator, not handed to her. Decided
  before the Shariah Supervisory Board ruled; add it to the Board's
  review list.
  - The code doesn't record the authorisation. Proposed, not yet
    decided: it stays with the operator, with her records, and auditors
    check it when they sample claims on site.
- **Database:** a claim's totals must equal its lines' (a deferred check),
  lines are insert-only, a claim never changes, its status moves only
  forward, the zakah link is set once, and nothing is deleted.

Slice 8, public page and monthly report (built, `ClinicMonthlyReport`,
`ClinicReportsService`; `GET /clinic-gifts/clinics/:slug/report`, public).
- **Targets:** endowment, and running fund a month, set by a Mutawalli
  Officer on the clinic (`clinic_waqf.manage`).
- **Each pot shown on its own,** from the ledger: the endowment (endowed,
  premises and equipment, invested, cash); the running fund (gifts,
  endowment income, spent on subsidised visits, running costs); zakah
  (paid for patients' bills, counted once its distribution is paid).
- **Monthly figures, fixed measures only** (visits, children immunised,
  tests run, referrals), with no free text, so nothing to overstate.
  - A Mutawalli Officer records them from the operator's report
    (`clinic_waqf.report_record`).
  - Compliance or the Audit Committee publishes them
    (`clinic_waqf.report_publish`), never whoever recorded them (a CHECK).
  - Published figures never change.
- **Subsidised visits by service and patients subsidised** come from
  approved claims. Nothing about any giver, patient or member of staff is
  shown.

Slice 9, equipment replacement reserve (built, `ClinicReserveService`).
**Owner's decision, 2026-11-17: a reserve is allowed, since it is spent
only on replacing the waqf's own equipment. Built before the Shariah
Supervisory Board ruled on it** (plan question 9); add it to the Board's
review list. The rest of question 9 (what a donor of land or a building
must own and agree to, their conditions, istibdal) stays open.
- **Funding:** the Board sets a share of the endowment's income
  (`clinic_waqf.reserve_share_set`; a Mutawalli Officer proposes). Each
  income receipt sets that share aside at once, rounded down to the kobo
  (1150 / 1100, both running fund), in the same transaction that records
  it. A CHECK refuses a share without an approving action.
- **Use:** only replacing equipment on the register (`ClinicSpend` kind
  `reserve_replacement`, naming `replacesAssetId`; one live replacement per
  asset, a database index). It goes through endowment spending's approve,
  pay and confirm flow, limited by the reserve's cash; endowment cash never
  pays for it, and the reserve never pays anything else.
- **Booking once paid:** the running fund pays (5200 / 1150), the new
  equipment joins the endowment (1500 / 3100), and the item it replaces is
  retired at its booked value (3000 / 1500). Each pot balances on its own.
- **Public page:** what the reserve holds and has spent, under the running
  fund.

**Update, 2026-11-17 — the clinic waqf becomes the first "waqf programme"
(shared layer, step 1 of 4).** Owner's decisions: build a shared layer for
waqfs Birr establishes and curates, so other products (the proposed
need-based waqf first; design:
https://claude.ai/artifact/HChJqo1PiWG592hc6UwTda) reuse the clinic's
general parts; call it a **waqf programme**. Founders' own Waqf Funds,
Vault and zakah stay separate.
- **Step 1 (this):** names only, no behaviour change
  (`20261118070000_waqf_programmes_rename`).
  - `ClinicWaqf` is now `WaqfProgramme` (`waqf_programmes`), with a fixed
    `product` (`WaqfProgrammeProduct`; only `clinic` so far). The
    operator may be set only on a clinic (a CHECK).
  - The deed, pots and ledger, gifts, assets, works, spends, investments
    and their income are `WaqfProgrammeDeed`, `WaqfProgrammePot`,
    `ProgrammeLedgerAccount`, `ProgrammeJournalEntry(Line)`,
    `ProgrammeGift`, `ProgrammeAsset`, `ProgrammeWorksProject`,
    `ProgrammeSpend`, `ProgrammeInvestment(Income)`.
  - Every `clinicWaqfId` is `programmeId`, including on the clinic-only
    tables, which keep their names: `ClinicPriceList`, `ClinicClaim(Line)`,
    `ClinicMonthlyReport`.
  - `RecurringGiftKind.clinic` is `programme`; `RecurringGift.programme*`;
    `Founder.programmeSupporter`.
  - Constraint, index and trigger names, and the rule functions (which
    name tables as text), follow the new names.
- **Step 2 (built):** the code is split, and the permission keys too
  (`20261118080000_programme_permission_keys`).
  - `modules/waqf-programmes`: the general parts (`WaqfProgrammesService`,
    `ProgrammeLedgerService`, `ProgrammeGiftsService`, `ProgrammeAssets`,
    `ProgrammeSpending`, `ProgrammeInvestments`, `ProgrammeReserve`).
    `modules/clinics`: the clinic's own (price lists, claims, monthly
    figures, the public report, the standard deed wording).
  - API: Ops `/waqf-programmes/...` (clinic-only routes under the same
    address, from `ClinicsOpsController`); public giving `/programme-gifts`,
    Founders' monthly `/programme-gifts/founder/monthly`; the public clinic
    list and report `GET /clinics`, `/clinics/:slug/report`. Web page
    addresses (`/clinics/...`, `/clinic-gifts/...`, `/ops/clinic-waqfs`) and
    the Paystack return path are unchanged.
  - Permissions: `waqf_programme.*` (manage, deed, establish, assets,
    works, spending, investments, reserve) and `clinic.*` (operator, price
    list, claims, monthly figures). Renamed in place, so every grant and
    governed action keeps its permission.
  - Audit actions follow (`waqf_programme.*`, `waqf_programme_deed.*`,
    `programme_gift.*`, `programme_asset.*`, `programme_works.*`,
    `programme_spend.*`, `programme_investment.*`;
    `clinic.operator_assigned`; clinic price list, claim and report actions
    unchanged). Rows written before keep their old names. The
    reconciliation label is `programme_gift`.
- **Step 3 (built): the product list.** `WAQF_PROGRAMME_PRODUCTS` in
  `@birr/shared` names each product's label and public address, its pots,
  its kinds of endowment payment, its default causes, its monthly measures
  and its own parts. The backend adds each product's standard deed wording
  (`programme-products.ts`, typed by the database's `WaqfProgrammeProduct`,
  so a new product won't compile without one); a test checks the list
  names exactly the database's products, pots and payment kinds.
  - A programme serves causes from the cause catalog
    (`WaqfProgrammeCause`): a new one takes its product's defaults (the
    clinic: Healthcare, and existing clinics were tagged by migration
    `20261118090000_waqf_programme_causes`); `PUT /waqf-programmes/:id`
    with `causeCategoryIds` replaces the set (current catalog entries
    only), audited. A tag only: it moves no money.
  - Creating a programme now names its product.
  - **Waits for the second product:** a loan pot, and refusing a product's
    own parts (or pots and payment kinds it doesn't list) for other
    products. With only clinics there is nothing to refuse or test; add
    them with the need-based waqf.
- **Step 4 (built): Ops Console → Waqf Programmes** (`/ops/waqf-programmes`;
  the old `/ops/clinic-waqfs` addresses redirect, `next.config.mjs`).
  - The list filters by product, cause and status (`GET /waqf-programmes`
    `?product=&causeCategoryId=&status=`) and shows each programme's
    product and causes. Creating one names its product.
  - The detail page names the product, changes the causes
    (`CausesEditor`, `waqf_programme.manage`), and shows a product's own
    cards only on that product (price list, claims and monthly figures on
    clinics).
- The shared layer is complete for the clinic. The need-based waqf adds
  its own parts on it once it has the go-ahead (see the design doc's
  build order).

Next steps for the clinic (2026-11-17; all nine slices are built and
merged, nothing is live, no operator or site exists yet; the plan doc's
"Timeline and next steps" is the working list):
- **Board of Trustees:** agree the direction, approve establishing the
  clinic waqf, and approve the search for an operator.
- **Shariah Supervisory Board:** rule on plan questions 2 to 4 first
  (categories, Birr's two roles, supporters as co-waqifs), and confirm the
  owner's decisions on questions 1 and 9.
- **Legal:** answer its questions 1 to 3 first (legal form, operator
  agreement, property), and approve the draft deed wording
  (`clinic-waqf-deed.ts`) with the Shariah Supervisory Board.
- **Mutawalli Officer:** open the call for operators in Ibadan and ask each
  shortlisted one for a costed plan.
- **Finance:** open the clinic waqf's bank account and Paystack subaccount,
  then set `CLINIC_WAQF_SUBACCOUNT_CODE` in Platform Settings; no gift is
  taken until it's set.
- **Engineering:** choose always-on production hosting and deploy
  (`docs/deploy-checklist-2026-11.md`); monthly charges and the daily
  reconciliation need it.
- **Investment Committee:** register the shortlisted operator as a
  counterparty (`counterparty.register` is theirs alone unless Roles &
  Access changes it).
- **Compliance:** record and verify the operator's four licences before it
  is onboarded and assigned (`clinic_waqf.operator_assign`).

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
  Vault's own six governed actions (publishing, cause/proceeds
  allocation, investment change, distribution approval, contribution
  refund) go through the exact same `governed_actions` table and the
  same DB constraint — one shared engine, not a second copy for Vault.
- **Founder/waqf isolation, not tenant isolation**: there is no per-org
  admin console to isolate. Isolation is scoped through `waqf_founders`
  and `founder_memberships` — a Founder sees only the waqf(s) they
  established, nothing about any other Founder. This doesn't apply to
  Vault at all — there's no Founder to isolate from; a Vault is created
  by staff and, once published, its existence and causes are public by
  design, not scoped to anyone.
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

**Update, 2026-10-18 — every staff write route now declares who may call
it.** An audit found ~35 staff write routes (recording proceeds,
approving beneficiary nominations, creating vaults, recording expenses,
...) open to any active staff member of any role, including
`external_auditor`. Each is now gated with `@RequiresStaffRole`, per the
owner's explicit decisions: `platform_admin` is kept **out** of
fiduciary/operational work (it runs the platform, it doesn't handle the
money); day-to-day waqf and Vault operations, including Vault curation,
are `mutawalli_officer`; investments, placements and **proceeds
allocation are `investment_committee` only** (deliberately separated
from `mutawalli_officer`, who creates the distributions that allocation
caps); recording proceeds is either of those two; pausing/closing a
Vault is `mutawalli_officer` or `compliance_officer`; reviewing a COI
declaration is `compliance_officer` only. `apps/backend/src/common
/guards/route-role-coverage.spec.ts` now fails on any new non-GET route
that has neither a role/permission decorator nor a reasoned entry in its
allowlist; a route that genuinely needs no staff gate (Founder
self-service, webhooks, own-account actions) goes in that allowlist with
its reason. Still open: merging
`@RequiresStaffRole` and the `roles`/`permissions` tables into one
permission-key model.

**Update, 2026-10-18 — adding a staff member is a governed action
(`staff.invite`).** Before this, one `platform_admin` could invite anyone
into any role alone, including a second account of their own under a
checker role. That let one person be both maker and checker on every
governed action, because the `checker_not_maker` constraint compares user
ids, not people. Owner's decisions: maker `platform_admin`; checkers
`board_of_trustees` / `compliance_officer` (same as `staff.mfa_reset`). The
invitation is only created on approval and emailed after the transaction
commits. `InvitationsService.invite()` refuses the `birr_staff` kind, and the
unused direct-create `POST /birr-staff` is gone. **Staff invitation links
are email-only** (owner's choice over admin-only copy-link): the API returns
`token: null` for staff invitations and audit snapshots store
`"[redacted]"`. Previously any signed-in staff member could copy a pending
staff link and take that seat. A failed email is retried via
`POST /invitations/:id/resend-email`. A brand-new deployment with no
Board/Compliance member gets its first approver from the server-only
`bootstrap-first-approver` script (owner's choice over an in-app
exception). It refuses once any active approver exists. Runbook:
`docs/staff-onboarding.md`. Changing an existing staff member's roles
(Phase 2, below) and suspending or reinstating them (2026-11-15, below)
now use the same two-person rule.

**Update, 2026-10-18: one named-permission model for all staff access
(Phase 1 of 3).** Every staff route now declares a named permission:
`@RequiresAccess("vault.curate")` for a plain action, `@RequiresPermission`
for governed maker/checker ones. Grants live in `seed-data.ts`
(`accessPermissions` alongside the governed list). `@RequiresStaffRole` and
`StaffRoleGuard` are gone. In-service checks use `staffHasAccess(staff,
key)`, e.g. `caseload.view_all`. The Ops Console decides access from
permissions rather than role names: `GET /birr-staff/me` returns
`permissions` and components call `useStaffSession().can(key)`. Showing a
role name as a label is still fine. Converting the 97 old role checks changed no
access; a per-route before/after comparison showed 0 differences. Owner's
decisions for the next phases: **Phase 2 (built 2026-10-18)**, a staff
member may hold several roles (`birr_staff_roles`, replacing
`BirrStaff.staffRole`; access is the union of their roles' permissions).
An External Auditor may hold no other role, and everyone keeps at least one
role; both are enforced by database triggers. Adding or removing a role is
the governed `staff.role_add` / `staff.role_remove` (maker platform_admin;
checkers board_of_trustees / compliance_officer). Nobody proposes or
approves a change to their own roles, and the last active platform_admin
keeps that role. **Phase 3 (built 2026-10-18)**, grants are editable in
the Ops Console (Roles & Access) through the governed
`role.permission_change` action: proposed by `platform_admin`, approved by
the **Board of Trustees only**, with **every permission editable**,
including the staff-security ones and this editor itself. That was the
owner's explicit choice over locking them. A Board member may approve a
change to the Board's own permissions; the approval screen says so. Three
guard rails apply to every edit (the owner's choice), enforced at proposal
and again at approval; changing them means changing the code, not the
Ops Console: (1) no lock-outs, so every governed action keeps at least
one role able to propose it and one able to approve it, each held by an
active person; (2) no role both proposes and approves the same governed
action; (3) external_auditor gets neither propose nor approve on any
governed action (to change this, change checkPermissionChanges in modules/roles/permission-changes.ts). The database is now the source of truth for grants:
`sync-permissions` (every deploy, and the full seed) only adds new
roles, permissions and missing grant rows; it leaves existing grants as
they are unless run with `--reset`. A changed default in `seed-data.ts` for an existing
permission therefore no longer reaches a running database by itself; change
it in the Ops Console instead. `sync:permissions --reset` is the
deliberate way back to exactly `seed-data.ts`, and discards Board-approved
changes.

## Core entities (build in this order)
1. `users` (global accounts), `founders`, `founder_memberships`
2. `birr_staff`, `roles`, `permissions`, `role_permissions`
3. `waqfs` (type: Investment / Asset / Project), `waqf_founders`
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
10. `vaults`, `vault_causes`, `vault_donors`, `vault_donor_thresholds`,
    `vault_contributions`, `vault_investments`, `vault_proceeds`,
    `vault_distributions` — Vault's own entities (see the "Update,
    2026-09-10/11 — Vault" note above), parallel to the Waqf-side ones
    above, never extending them. No `vault_founders`-style join table
    exists or should be added — a Vault has no Founder to join to.

**Update, 2026-09-03 — `WaqfType` dropped `hybrid`.** A Founder can
already establish as many separate Waqf Funds as they like under one
Foundation, so a fund spanning more than one purpose was never actually
distinct from just establishing two funds — a fourth type added a
choice with no real behavior behind it. Owner's explicit decision;
confirmed zero `waqfs` rows and zero `cause_categories
.typicalWaqfTypes` entries used it before the enum value was dropped
(`packages/db/prisma/migrations/20260903102618_remove_hybrid_waqf_type`).
`WaqfType` is now Investment / Asset / Project everywhere — schema,
Founder Portal's fund-type picker, Ops Console.

**Update, 2026-09-26 — corrects item 3 above: there is no `waqf_founders`
join table.** A comprehensive codebase audit checked this build-order
list against the actual schema and found it names a table that doesn't
exist — the real, more mature model (already assumed by this file's own
"What this is" section, just never reconciled back to this list) is
`Foundation` → `FoundationFounder` (join) → `Founder`, with `Waqf
.foundationId` pointing at `Foundation` directly. A Waqf's founder
relationship is established transitively through its Foundation, not a
direct per-waqf join — which is also how a Project Waqf can still end up
with more than one Founder (via `FoundationFounder`), the exact
behavior item 3's own parenthetical was trying to describe. This is a
documentation-lag fix, not a schema change — nothing about the actual
data model changed here.

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

**Update, 2026-09-01 — that constraint is jurisdiction-specific, not
universal.** Birr today operates only as a non-profit registered in
Nigeria, where there's no such thing as a trustee license that expires
or a jurisdiction-scoped limitation on operating — the `TrusteeLicense`
model's "unlicensed" status, surfaced identically for every jurisdiction
regardless of whether one actually applies there, was flagging a
compliance gap that isn't real for Nigeria's case. Raised directly with
the owner as the system's own instruction above (flag jurisdiction-
specific licensing) colliding with the concrete fact that not every
jurisdiction has such a regime to begin with; the owner's direction was
to keep the underlying model rather than delete it, since Birr may
still end up trustee somewhere that does license/regulate trusteeship —
deleting it would mean rebuilding it from scratch at that point.
`CompliancePolicySet` (the existing per-jurisdiction registry Birr's own
compliance/legal staff populate through the Ops Console) now carries a
`requiresTrusteeLicense` boolean, defaulting to `true` so an
unconfigured jurisdiction still gets flagged exactly as before — it
takes an explicit staff decision through the Ops Console to mark a
jurisdiction as not requiring one, never silent absence.
`TrusteeLicensesService.statusForJurisdiction` returns a distinct
`"not_required"` status (never blocking, same as every other status
here) for a jurisdiction explicitly marked this way, and the expiry-
check scheduler ignores any stray license row left in one. Nigeria
itself isn't seeded with this automatically — that's still a real
compliance/legal call for a human to make through the Ops Console, not
something to hardcode from a chat instruction.

**Update, 2026-09-16 — corrects the note above: Nigeria does have a real
trustee-registration regime, and Birr already holds it.** The 2026-09-01
claim that Nigeria has "no such thing as a trustee license" was wrong.
An NGO's trustee standing in Nigeria is established through registration
as an Incorporated Trustee with the Corporate Affairs Commission (CAC)
— that registration IS Nigeria's trustee license, and Birr has already
registered. This isn't the `CompliancePolicySet.requiresTrusteeLicense
: false` ("not_required," a jurisdiction with no such regime) case the
2026-09-01 note reached for — Nigeria does require this, Birr just
hadn't recorded holding it. Fixed by entering it through the Ops Console
exactly as the model was built for: an active `TrusteeLicense` row for
jurisdiction `NG`, licensing authority Corporate Affairs Commission
(CAC) — once that row exists, `TrusteeLicensesService
.statusForJurisdiction` returns `"active"` on its own, no code change
needed. This was a data-entry gap, not a modeling gap.

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
  the backend guards (`SessionAuthGuard`, `PermissionGuard`; the former
  `StaffRoleGuard` was folded into `PermissionGuard` on 2026-10-18),
  untouched by this change. `/ops/sign-in` being
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
- **In one transaction, take every other lock before writing the first
  audit row.** Writing an audit row takes the audit chain's lock until
  commit, so a transaction that audits first and locks second deadlocks
  with one that locks first and audits second. `GovernedActionsService
  .decide()` writes its decision row after the handler runs for this
  reason (a zakah approval deadlocked with a new distribution,
  2026-11-15).
