---
sidebar_position: 5
title: Payment Reconciliation
description: How Birr checks Paystack's records against its own every day, what each mismatch means, and what Compliance does about it.
---

# Payment Reconciliation (Plain-English Guide)

Every day Birr checks that Paystack and Birr agree about money: money
coming in, money going out, and refunds. Anything that doesn't match is
listed for Compliance. **Nothing is changed automatically.** A person
always looks first.

## What's checked

| | What Paystack lists | What Birr compares it with |
|---|---|---|
| **Money in** | Payments into Birr's Paystack account | Waqf contributions, Vault gifts and zakah payments, monthly charges included. For zakah, the zakah plus any fee the payer covered. |
| **Money out** | Transfers from Birr's Paystack balance | Waqf distributions and Vault distributions paid through Paystack |
| **Refunds** | Refunds of earlier payments | Vault gifts Birr has refunded |

Zakah distributions and zakah refunds are paid by bank transfer from the
zakah account, not through Paystack, so they aren't part of this check.

## When it runs

Shortly after **2am Lagos time**, Birr checks the day before. A
Compliance officer can also check any past day with **Run now**, for
example after fixing something.

Paystack is read for the day before and after as well, so a payment
started at 11:59pm that Paystack logs at 12:01am is still found, not
reported missing. Only records from the day itself are judged.

**Example.** On 16 November at 2am, Birr checks 15 November. Paystack
shows four payments in; Birr has five. One of Birr's, a ₦250,000 Vault
gift, is marked confirmed but Paystack has no such payment. That's one
mismatch, and Compliance gets an email and an in-app notice.

## What each mismatch means

| Mismatch | What it means | Where to start |
|---|---|---|
| Paystack took a payment Birr has no record of | Money arrived that Birr can't account for | Find the payer in Paystack's dashboard; work out which gift it was meant to be |
| Confirmed at Birr, nothing at Paystack | Birr counted money it may not have | Treat as serious: check whether the payment really happened |
| Paid at Paystack, pending or failed at Birr | Usually a webhook that never arrived | **Ask Paystack again**. If Paystack confirms, the gift is confirmed at Birr through the normal path |
| Amounts differ | Paystack and Birr disagree on the sum | Compare both records; never adjust one to match without finding why |
| Transfer Birr has no record of | Money left Birr's balance unexplained | Treat as serious: check Paystack's transfer and who started it |
| Paid out at Birr, no transfer at Paystack | Birr thinks a beneficiary was paid who may not have been | Check with the beneficiary and Paystack |
| Refund mismatches | A refund happened on one side only | Check the refund in Paystack's dashboard |

## Acting on a mismatch

Under **Compliance → Payment Reconciliation**:

- **Ask Paystack again** (incoming payments only) runs the same safe check
  a giver's return page uses, including the amount check. It may confirm
  or fail the payment at Birr. It does not close the mismatch.
- **Mark resolved** needs a note saying what was found and what was
  done. The database refuses a resolution without who, when and why.
- A mismatch found again the next day isn't listed twice while it's open.

Who can do what:

| | Can |
|---|---|
| Compliance | See, ask Paystack again, resolve, run a day |
| Audit Committee, Board of Trustees, Mutawalli Officers | See |

Every run, re-check and resolution is in the audit log.

## In a development database

Test runs create thousands of confirmed gifts whose references Paystack
has never seen, so a check of any day tests ran will flag them as
"confirmed at Birr, nothing at Paystack". That is the check working; a
live system won't have them.
