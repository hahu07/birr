---
sidebar_position: 3
title: Running Zakah
description: How Birr's staff run zakah day to day, who proposes and who approves each step, and the rules the system enforces.
---

# Running Zakah (Plain-English Guide)

The public side of zakah is explained on the
[public Zakah page](https://birr-docs.onrender.com/zakah). This page is
the staff side: what each Ops Console screen is for, who does each step,
and which rules the system enforces whatever anyone clicks.

**The one thing to remember:** with zakah, Birr is each payer's
**agent** (*wakil*), not a trustee, and never the owner. Zakah is held
for its recipients from the moment it arrives. So it has its own bank
account, its own ledger and its own records, and is never mixed with
Waqf Fund or Vault money. It's booked as a **liability** ("held for
recipients"), never as Birr's revenue, and **all of it reaches
recipients**. Birr takes no administrators' share, and processing fees
come from the payer (if they choose) or from Birr's operating funds,
never from the zakah.

**Our example cast:**

- **Yusuf**, Mutawalli Officer: runs zakah day to day.
- **Maryam**, Shariah Supervisory Board: approves rulings, recipients
  and payouts.
- **Hauwa**, Risk & Compliance: approves prices and payouts, and owns
  anti-money-laundering (AML) follow-up.
- **Bello**, Investment Committee: proposes gold and silver prices.
- **Chinedu**, Audit Committee: confirms money actually left the bank.
- **Zainab**, Board of Trustees: approves refunds.

And **Amina**, a payer from the public page, who has just paid
₦95,000 of zakah.

## The three screens

| Page (Ops Console sidebar) | What it's for |
|---|---|
| **Zakah** (Portfolio) | Rulesets, gold and silver prices, incoming payments (with holds), refunds, and Zakah al-Fitr seasons. |
| **Zakah Distributions** (Portfolio) | The register of verified recipients, and paying zakah out to them or to partner organizations. |
| **Zakah Giving Review** (Compliance) | A list of payment patterns worth a human look for possible structuring. Only some roles see it; see [Who can see the review list](#who-can-see-the-review-list). |

## Before the calculator opens

The public calculator stays closed until both of these are approved.

### Rulesets: the madhhab rulings

A ruleset holds the points where the schools differ: how jewellery is
treated, how debts are deducted, and the nisab basis and weights. They
are data, so the Board can change them without a code change.

1. **Yusuf drafts** a ruleset (four drafts, Maliki, Hanafi, Shafi'i and
   Hanbali, come bundled as starting points) and **proposes** it.
2. **Maryam approves** it. Only a Shariah board member can; these are
   Shariah rulings, not Board of Trustees decisions. The proposal
   carries a snapshot of the rulings, so Maryam approves exactly what
   Yusuf proposed. Approving a new version replaces the previous one.

The calculator refuses a draft ruleset outright. The most important
open decision is the **nisab basis** (gold, silver, or whichever is
lower): a gold-based nisab is roughly ten times a silver-based one in
Naira, so it decides whether a payer like Amina owes anything at all.

### Gold and silver prices

The prices set the nisab in Naira, so two people set them.

1. **Bello proposes** today's gold and silver prices per gram.
2. **Hauwa approves** them. Only Compliance can. The approval screen
   shows the change in Naira and as a percentage against the current
   prices, so a mistyped zero stands out.

Payers are warned once the approved prices are more than **7 days**
old, and the calculator refuses to give a figure after **31 days**.
Keep them fresh.

## Taking payments

Paying opens only when both of these are in place:

- **The agency wording** a payer accepts is approved by the Legal
  Adviser and the Shariah Supervisory Board. The current text is a
  draft. Each payment records the version its payer accepted, and the
  server refuses a payment that accepted anything other than the
  current one.
- **The zakah bank account is connected.** Zakah settles through a
  Paystack subaccount into its own bank account. A platform admin sets
  it in **Settings** (`ZAKAH_SUBACCOUNT_CODE`). No zakah payment is
  taken until it's set.

Amina's ₦95,000 then appears under **Payments** on the Zakah screen,
once Paystack confirms it.

### Pools

Zakah is kept in three separate pools, each with its own ledger
account and its own spending limit:

| Pool | Ledger account |
|---|---|
| Zakah on wealth | 2000 |
| Zakah al-Fitr, food | 2100 |
| Zakah al-Fitr, cash | 2200 |

All three sit in the one zakah bank account (ledger account 1000), but
they **never lend to each other**. A payment's pool never changes, and
money committed from one pool can never exceed what that pool has
received.

### Holds (AML)

If a confirmed payment looks wrong, **Hauwa or Yusuf can put it on
hold**, with a written reason. A hold reserves that payment's zakah
out of its pool's spending limit, so it can't be paid out while it's
being looked at.

- **Only Compliance can release a hold**, and doesn't need a second
  person to do it.
- A hold is **refused once that zakah has already been committed** to
  recipients. Follow up off-platform instead, for example with a report
  to the NFIU.
- A held payment can still be refunded. The refund takes over the
  reservation.
- **The payer is never told about a hold**, on screen or by email.
  Telling them would be tipping off.

## Paying zakah out

### Registering recipients

Individuals have to be verified as eligible before they can be paid.

1. **Yusuf registers** a recipient: name, phone, bank details, which of
   the eight categories they qualify under, and a written reason.
2. **Maryam or Hauwa approves** them. The approver can never be the
   person who registered them.

Changing an approved recipient's **bank details or categories** needs
the same second-person approval. The new bank details wait, encrypted,
until it's given, and the database itself refuses any other change to
them. Name, phone, the written reason and deactivating someone take
effect immediately.

### Distributions

A distribution pays one approved recipient, or one active, vetted
partner organization, in one category.

1. **Yusuf creates** the distribution and proposes it.
2. **Maryam or Hauwa approves** it.
3. **Yusuf pays it by bank transfer from the zakah account**, never
   through Paystack payouts (those draw on Birr's main balance), and
   records the bank reference.
4. **Hauwa or Chinedu confirms** the reference. Only then is the
   distribution booked as paid.

**Example:** Yusuf registers Fatima, a widow in Kano, under "the poor";
Maryam approves her. Yusuf proposes paying her ₦60,000 from Amina's
pool; Hauwa approves. Yusuf sends the transfer from the zakah account
and enters the reference, and Chinedu confirms it against the bank
statement.

Rules the system enforces:

- **The administrators' share (*al-'amilin*) is closed**, in the code
  and by a database check, because all zakah reaches recipients.
- **Zakah al-Fitr goes only to the poor and the needy** (a database
  check).
- **A partner has to report back** the people they reached; Yusuf
  records that report on the distribution.
- **Nothing can commit more than its pool has received**, checked under
  a lock, so two people approving at the same moment can't overspend.

## Refunds

Refunds are for **mistakes only**: paid twice, wrong amount, or a
payment the payer didn't authorise. Never a change of mind.

1. **Hauwa records the request** and the payer's bank details, and
   proposes the refund.
2. **Zainab approves** it. Only the Board of Trustees can, as with
   Vault refunds.
3. **Yusuf pays it by bank transfer from the zakah account** (never a
   Paystack refund, which would come out of Birr's main balance) and
   records the reference.
4. **Hauwa or Chinedu confirms** the reference.

Only the zakah is refunded, never a processing fee the payer chose to
cover. Refunds share the distributions' spending limit, so zakah
already committed to recipients can't be refunded, and a payment's
refunds never add up to more than its zakah.

If the payer gave an email, they're told when the refund is approved
and again when it's paid (amount, last four digits of the account, bank
reference). A rejection is never emailed, and no email says why.
Compliance tells the payer.

## Zakah al-Fitr seasons

Each Ramadan, Zakah al-Fitr gets its own season on the Zakah screen.

1. **Yusuf drafts the season**: the staple food, how much is one *sa'*,
   its value in Naira per person, and the dates.
2. **Maryam approves** it. If Eid moves, the season can be revised and
   approved again as a new version.

Payments close **the day before Eid**, enforced by the database, so
there's time to deliver. **Hauwa or Yusuf can close payments early**,
for example once Eid is announced, without a second person.

Payers choose **food** (open to every school) or **cash** (only under
an approved Hanafi ruleset, checked on the server). The server always
works out the amount as people × the season's amount per person,
whatever the browser sent.

## Who can see the review list

**Zakah Giving Review** is purely observational, like Vault Giving
Review: nothing on it blocks a payment. It shows:

- payers paying close to the Naira ID threshold into the same pool;
- different payers sharing a network;
- giving that spans **Vault and zakah**: the same email whose combined
  Naira giving reaches the threshold, or one network used by givers to
  both products under different emails. The threshold check itself
  never adds Vault and zakah giving together, so this list is where
  that gap is covered.

It's visible to **Compliance, the Audit Committee, the Board of
Trustees and Mutawalli Officers**, and deliberately **not** to platform
admins (unlike Vault Giving Review). Acting on something you see here
is a separate step: put the payment on hold from the Zakah screen.

## Who does what, at a glance

These are the default grants. A platform admin can propose a change
under **Roles & Access**, which the Board of Trustees then approves,
but nobody can ever approve their own proposal.

| Step | Proposes / does it | Approves / confirms |
|---|---|---|
| Ruleset | Mutawalli Officer | Shariah board member only |
| Gold and silver prices | Investment Committee | Compliance only |
| Register or change a recipient | Mutawalli Officer | Shariah board member or Compliance |
| Distribution | Mutawalli Officer | Shariah board member or Compliance |
| Distribution paid | Mutawalli Officer | Compliance or Audit Committee |
| Refund | Compliance | Board of Trustees only |
| Refund paid | Mutawalli Officer | Compliance or Audit Committee |
| Zakah al-Fitr season | Mutawalli Officer | Shariah board member only |
| Hold a payment | Compliance or Mutawalli Officer | (no second person) |
| Release a hold | Compliance only | (no second person) |
| Close Zakah al-Fitr early | Compliance or Mutawalli Officer | (no second person) |
