---
sidebar_position: 4
title: Vaults
description: Birr-curated public giving campaigns anyone can donate to, with no Founder, account, or establishment involved.
---

# Product Two: Vaults

## What a Vault is

A **Vault** is a public giving campaign — for example, "Ramadan Relief
Vault" — that Birr's own staff create and curate, tied to one or more
causes. Anyone can give to an open Vault directly. There is no Founder
involved in a Vault at any point: no Foundation, no deed, and no
account of any kind. A Vault donor never becomes a Founder, and a
Founder's Waqf Fund is never a Vault.

Vault exists to serve a different need than a Waqf Fund does: a Waqf
Fund is one Founder's own endowment, built for that Founder's specific
purpose; a Vault is a pooled, public campaign anyone can contribute to,
the way a platform-run fundraiser works — but administered under the
exact same fiduciary standards as everything else Birr holds.

|  | Waqf Fund | Vault |
|---|---|---|
| Who creates it | The Founder, self-service | Birr's own staff only |
| Who gives to it | The Founder (and anyone they invite) | The general public, by name or anonymously |
| Getting started | Self-service, no approval gate | Publishing a Vault is itself a governed, maker-checker-approved decision |
| Who receives payouts | Individually vetted, named Beneficiaries | Vetted delivery/relief-partner organizations (Counterparties) |

Vault deliberately reuses the same underlying infrastructure the
[Waqf Fund](./waqf-funds) product already has — the same three payment
rails, the same standard Cause catalog, the same partner-organization
registry, and the same maker-checker governance engine — rather than
duplicating any of it. What's new is a public-facing surface on top:
anyone can browse open Vaults and give, with no session, no account,
and no prior relationship with Birr.

## The two types of Vault

Vault has two types, mirroring the "corpus vs. direct spend" distinction
Waqf Funds make with three:

| Type | How pooled gifts are used |
|---|---|
| **Investment-style** | Pooled gifts are placed with a vetted partner organization; the return funds the Vault's causes, and the pooled corpus itself is preserved (the same perpetuity principle as an Investment Waqf Fund) |
| **Project-style** | Pooled gifts go directly to the Vault's causes — relief, education, or whatever the campaign was created for |

There is no Vault equivalent of an Asset Waqf Fund: a Vault is always
pooled, fungible cash, never a registered individual asset.

## How giving works

```mermaid
flowchart LR
    A["Browse open Vaults<br/>(no account needed)"] --> B["Give — pick an amount,<br/>optionally a cause,<br/>pay via Paystack"]
    B --> C{"Email provided?"}
    C -->|Yes| D["Receipt sent on confirmation"]
    C -->|No — anonymous| E["No receipt;<br/>anti-structuring check skipped"]
    D --> F["Payment confirmed<br/>via provider webhook"]
    E --> F
    F --> G["Funds pooled toward<br/>the Vault's causes"]
```

1. **Browse** — anyone can see every open Vault and the causes it
   supports, with no account required.
2. **Give** — pick an amount, optionally earmark a specific cause within
   the Vault, and pay through Paystack (bank transfer or local card).
   Providing an email is optional, not required: giving anonymously is
   allowed, at the cost of two things — no receipt can be sent, and
   Birr's anti-structuring check (below) has no way to catch someone
   splitting one large gift into several small anonymous ones.
3. **Confirm** — the payment provider confirms completion via the same
   webhook-based mechanism a Waqf Fund contribution already uses.

## Giving monthly

You can give the same amount to a Vault every month instead of once.

1. On the Vault's page, choose **Monthly**, enter the amount and your
   email. The email is required for monthly giving: it's where your
   receipts, reminders and private link go.
2. Pay the first gift by **card** through Paystack. Only a card can be
   charged again each month; bank transfer and USSD can't.
3. From then on, Birr charges the same card on the **same day of each
   month** (the day you started, or the 28th if you started later in the
   month), at about 9am Lagos time. You get an email three days before
   each charge.

**Amina** starts a monthly gift of ₦250,000 to the Ramadan Relief Vault
on 15 November. She pays the first ₦250,000 then, and her card is
charged ₦250,000 on 15 December, 15 January, and so on.

**Managing it.** Every setup email carries a private link where you can
change the amount, update your card or cancel, at any time, with no
account. Anyone with the link can manage the gift, so keep it to
yourself. Lost it? Use **Email me my links** at `/giving/manage` and new
links are sent to your email; the old ones stop working.

**If a payment doesn't go through,** Birr tries again a day later and
three days after that. If all three fail, the gift pauses until you
update your card. Each month is charged at most once.

**Each monthly gift is checked like a one-off gift.** If the Vault
closes, your monthly gift ends. If your total giving reaches the level
where the law requires us to record who you are, the gift pauses until
you add your full name and ID from your link.

## Governance and compliance controls

A Vault's own money-moving decisions run through the identical
maker-checker engine described in [Governance](./governance), via
**six governed actions**:

1. **Publishing** a draft Vault — the moment it starts publicly
   soliciting money at all.
2. **Allocating** pooled contributions to a specific cause.
3. **Allocating** recorded investment proceeds to a cause
   (investment-style Vaults only).
4. **Changing** an investment's allocation (investment-style Vaults
   only).
5. **Approving** a payout to a delivery/relief partner.
6. **Refunding** a confirmed gift — reversing a payment when something's
   wrong with it, through an auditable in-platform decision rather than
   staff fixing it by hand on a payment provider's own dashboard.

Two additional compliance controls apply specifically to public giving:

- **An identity threshold, set per currency.** A single gift at or above
  the threshold — or a donor's running total across several gifts
  crossing it — requires their name and a form of identification before
  the gift can complete. This is an anti-structuring safeguard: it
  catches someone trying to avoid identity checks by splitting one large
  gift into several smaller ones.
- **A hold.** A compliance-tier staff member can flag any confirmed gift
  for review at any time, independent of whether it's ultimately
  refunded — this pauses nothing about the payment itself, just marks it
  for attention.
