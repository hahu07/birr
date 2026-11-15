---
sidebar_position: 4
title: Monthly Giving
description: How monthly Vault gifts, Waqf Fund top-ups and monthly zakah run, what staff see, and when Compliance stops one.
---

# Monthly Giving (Plain-English Guide)

Givers can give the same amount every month: to a Vault, to their own
Waqf Fund (founders), or as zakah paid in advance. This page explains
how it runs and what staff can do. The public side is on the Vaults,
Waqf Funds and Zakah pages of the public docs.

## How it works

1. **The first payment is an ordinary Paystack checkout, by card only.**
   When it confirms, Birr saves the card's Paystack authorisation
   (encrypted; Birr never sees the full card number). Only cards can be
   charged again, so bank transfer and USSD aren't offered for it.
2. **Each month after that,** Birr creates an ordinary pending gift and
   charges the saved card. It goes through exactly the same checks as a
   one-off gift: the Vault must be open, the amount must meet the
   minimum, the AML threshold applies, and zakah uses the wakalah terms
   and zakah account as usual. It's booked in the same ledger as any
   gift of that kind.
3. **Charges run at about 9am Lagos time** on the gift's day of the
   month (1st to 28th). The giver gets a reminder three days before.

**Example.** Amina gives ₦250,000 a month to the Ramadan Relief Vault
from 15 November. On 15 December at 9am her card is charged ₦250,000,
and the gift then waits for 15 January.

## What the system guarantees

- **A month is never collected twice.** The database allows only one
  payment per gift per month that hasn't failed, whatever happens.
- **Naira only,** on days 1 to 28, and never charged without a saved card.
- **Every change is in the audit log:** set up, card saved, each month
  collected, declines, pauses, amount changes and cancellations, with
  who did it.

## When a gift stops by itself

| What happened | What the gift does | What the giver does |
|---|---|---|
| Card declined | Tried again a day later, then three days later; paused after the third decline | Updates the card from their link (or the fund page) |
| Card expired | Paused before charging | Updates the card |
| AML threshold reached without an ID on file | Paused | Adds full name and ID from their link |
| Zakah wakalah wording changed | Paused | Reads and accepts the new wording |
| Minimum raised above their amount | Paused | Raises the amount |
| Vault closed, cause removed, or Waqf Fund no longer active | Ended | Nothing; it's over |
| Card can't be charged again | Ended after the first payment | Can start again with another card |

An ID already on file is enough for a monthly charge on the giver's own
card: they aren't asked to type it again each month.

## The Ops Console: Monthly Giving

Under **Compliance → Monthly Giving**, staff with `giving.monthly_view`
(Compliance, Audit Committee, Board of Trustees, Mutawalli Officers)
see every monthly gift: who gives, what to, how much, its status and
next charge, the card's last four digits, each payment, and its history.

**Stopping a gift** needs `giving.monthly_cancel` (Compliance only) and
a written reason of at least ten characters. The reason is kept in the
audit log. The giver gets an email saying their monthly gift has ended,
**never why**, so nothing tips them off. Stopping a gift only stops
future charges; past payments are untouched, and refunds work as usual.

## Things to know

- **Monthly zakah is paid in advance (ta'jil)** and went live before the
  Shariah Supervisory Board ruled on it (owner's decision, 15 November
  2026). The giving form tells payers that the Maliki school doesn't
  permit paying zakah early.
- **Vault and zakah givers have no account.** They manage their gift
  through a private emailed link; only a hash of it is stored. Asking for
  new links (`/giving/manage`) replaces the old ones.
- **Founders' top-ups** are managed on the fund's page in the Founder
  Portal and use the founder's account email.
