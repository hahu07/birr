---
sidebar_position: 2
title: The Ops Console
description: A plain-English, example-driven tour of every screen in Birr's staff console.
---

# The Ops Console (Plain-English Guide)

The [Founder Dashboard](https://birr-docs.onrender.com/founder-dashboard)
is "view and request, never govern." The **Ops Console** is the mirror
image of that: this is where the actual governing happens. If a
Founder asks Birr to approve something, an officer here is the one
who picks it up, and a *different* officer has to sign off before
anything really happens.

**Our example, this time from Birr's side:**

- **Yusuf** is a Mutawalli Officer — his day-to-day job is managing a
  caseload of waqf funds.
- **Zainab** sits on the Board of Trustees — she reviews and approves
  the bigger decisions Yusuf proposes.
- **Ibrahim** is a platform admin — the only role that can touch
  Birr's own account settings and payment provider keys.

The one rule that runs through the whole Console, and the reason it's
built the way it is: **the person who proposes a sensitive action can
never be the same person who approves it — not even if they happen to
hold both roles.** This isn't just a house rule Birr staff are trusted
to follow; the database itself refuses to save an approval where the
approver and the proposer are the same person. If Yusuf proposes a
₦4,800,000 scholarship payout, Yusuf cannot also be the one who
approves it — it has to be Zainab, or someone else, but never him.

The sidebar is grouped into five sections. Here's what's in each.

## Overview — the front page and your own to-do list

| Page | In plain English | Example |
|---|---|---|
| **Overview** | The same landing page every staff member sees — platform-wide totals across *every* Foundation and Waqf Fund Birr manages, not just one person's. | Ibrahim opens the Console and sees "₦2.1B declared corpus across 340 waqf funds" — the whole platform at a glance, not just his own work. |
| **My Desk** | A personal to-do list — only the waqf funds *this* staff member is actually assigned to. Only shows up in the sidebar at all if you have at least one assignment; a brand-new hire with no caseload yet never sees an empty page. | Yusuf's My Desk shows the 14 waqf funds he personally handles, not Birr's other 326. |
| **Messages** | One inbox for every Foundation that's messaged Birr, most recent first — so staff don't have to remember which Foundation to check. | A founder messages asking about a delayed distribution; it shows up here regardless of which officer is assigned to that fund. |

## Governance — where approvals actually happen

| Page | In plain English | Example |
|---|---|---|
| **Approvals** | The queue of everything waiting for a second person's sign-off — distributions, investment changes, asset disposals, beneficiary-criteria changes. This is the literal heart of the maker-checker rule described above. | Yusuf proposes releasing a scholarship payout. It sits here until Zainab — a different person — approves or rejects it. The system won't let Zainab be swapped for Yusuf under any circumstance. |
| **Founder Requests** | The staff-facing side of the "Requests" button Founders see on their own dashboard. Picking one up here doesn't itself approve anything — if staff agree with the request, they go create the *real* governed action over in Approvals, separately. | A founder asks for a bigger scholarship payout. Yusuf sees the request here, agrees, and creates the actual distribution proposal in Approvals — which then still needs Zainab's separate sign-off. |
| **Conflicts of Interest** | Where staff formally declare a personal conflict — e.g. a relative benefiting from a fund they manage. Anyone can declare their own, or review someone else's, but never review their own declaration. | Yusuf declares that his cousin's school is nominated as a beneficiary on a fund he oversees; a different officer reviews that declaration. |
| **AI Agents** | A registry of Birr's automated assistants (Rasid, Nazim, Kashif, and others) and what they've drafted so far. None of them can approve anything — ever — they can only *propose*, exactly like a junior staff member would. | Rasid drafts a compliance summary; it shows up here as a draft for a human officer to review, never as something already decided. |

## Portfolio — everything Birr holds in trust

| Page | In plain English | Example |
|---|---|---|
| **Foundations** | A read-only list of every Foundation that's been set up — Founders create these themselves (self-service), staff just see the result here afterward. | A Founder's Foundation shows up here the moment they finish setting it up — no staff action needed to create it. |
| **Waqf Funds** | The real entry point into a specific fund's full detail — its Assets, Beneficiaries, Investments, Distributions — grouped by Foundation, since a Foundation can have several funds under it. | Clicking into a specific fund shows Yusuf everything about that one fund. |
| **Vaults** | Birr's *other* product — public giving campaigns (like "Ramadan Relief Vault") that anyone can donate to directly, with no Founder or account involved at all. Staff create and curate these. | Ibrahim sets up a new "Clean Water Vault" campaign that any member of the public can give to without signing up. |
| **Counterparties** | The registry of outside banks and investment managers actually holding invested waqf money. A new one starts "pending review" and can't receive any money until it clears *two* separate checks: a Shariah sign-off, and a normal governed-action approval. | A new asset manager is added to hold part of an Investment waqf's capital — it sits pending until both gates clear. |
| **Cause Categories** | The standard list of causes Founders pick from (e.g. "Scholarships," "Clean Water Access") — maintained centrally by Birr so every fund draws from the same catalog. | This is the same list a Founder picks a cause from on their own dashboard. |
| **Vault / Waqf Ledger Accounts** | The underlying accounting "chart of accounts" — the categories money gets recorded against internally (asset, liability, revenue, expense, etc.) for Vaults and Waqf Funds respectively. Mostly invisible plumbing, only touched by platform admins. | Ibrahim adds a new expense-category ledger account so a new type of fee can be recorded correctly. |

## Compliance — staying within the rules

| Page | In plain English | Example |
|---|---|---|
| **Jurisdictions** | Which country-specific rules apply, and whether Birr's trustee registration is on file for that country. Doesn't block anything by itself — it's a record, not a gate. | Nigeria shows an active trustee registration (with the Corporate Affairs Commission) on file here. |
| **Shariah Prohibited Sectors** | The list a Shariah reviewer checks an investment against before approving it (e.g. alcohol, gambling, conventional interest-based lending). | Before Yusuf's team invests a fund's capital, it gets checked against this list. |
| **Audit Log** | A complete, permanent, unchangeable record of every important action anyone (staff, Founder, or AI agent) has taken on the platform. Nothing can ever be edited or deleted here — not even by an admin. | If a distribution ever gets questioned later, this log shows exactly who proposed it, who approved it, and when — permanently. |
| **Vault Giving Review** | A manual review tool for spotting someone trying to split one large public donation into several smaller ones under different email addresses to dodge ID-verification rules. Birr made a deliberate choice not to auto-block this — a human reviews the pattern instead. | Zainab notices five ₦1.9M donations from five different emails, all from the same device, within an hour — and flags it for follow-up. |

## Admin — running Birr itself

| Page | In plain English | Example |
|---|---|---|
| **Team** | The roster of Birr's own staff, plus anyone who's been invited but hasn't joined yet. New staff join by invitation only. | Ibrahim invites a new Compliance Officer; they show up here as "pending" until they accept. |
| **Roles & Access** | A read-only reference showing what each staff role (Mutawalli Officer, Board of Trustees, Shariah Supervisory Board, Investment Committee, Audit Committee, Risk & Compliance, Legal Adviser, External Auditor) is actually allowed to do. | Yusuf can check here to confirm he isn't able to approve his own proposals — the page shows the rule, it doesn't just describe it. |
| **Settings** | *Platform admins only.* Where Birr's own payment-provider credentials (Paystack, stablecoin gateway) live. Secrets are never shown back in full — only a masked preview — and must be fully retyped to change. | Ibrahim updates the Paystack API key after a routine rotation; no one, including him, can see the old key again afterward. |
| **Waqf Funding** | *Platform admins only.* Platform-wide funding rules, like the minimum corpus amount required to establish a waqf fund in a given currency. | Ibrahim sets a ₦500,000 minimum for new Naira-denominated waqf funds. |

## Who can see what

Not every staff member sees every page — the sidebar itself hides
what a given role can't use (so no one clicks something just to hit a
"you're not allowed" error), but the *real* enforcement always happens
on Birr's servers, independent of what the sidebar shows. A few
examples:

- **My Desk** only appears for staff who actually have a caseload —
  Ibrahim, if he has none, never sees it.
- **Settings** and **Waqf Funding** only appear for platform admins —
  Yusuf and Zainab wouldn't see either one in their own sidebar.
- Everyone can view **Roles & Access**, but only a platform admin can
  change anything on it.

This mirrors the same idea from the Founder Dashboard guide — the UI
just reflects what you're allowed to do; it's never the actual lock.
