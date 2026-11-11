# @birr/zakah

The zakah calculation engine, shared by the web app now and the mobile
app later. Plain TypeScript, no UI, no I/O: it takes the payer's
wealth, a ruleset and staff-set metal prices, and returns what's due
with a line-by-line breakdown.

```ts
import { calculateZakah } from "@birr/zakah";

// Amina: ₦3,000,000 savings, ₦1,200,000 shop stock, ₦400,000 debts.
const result = calculateZakah(
  { cash: "3000000", tradeGoods: "1200000", receivables: "0", metals: [], debtsDueNow: "400000" },
  approvedMalikiRuleset, // loaded from the database, approved by the Shariah Supervisory Board
  { goldPerGram: "…", silverPerGram: "…", asOf: "2027-02-08", source: "Birr staff" },
  { today: "2027-02-10" }, // prices over 7 days old are flagged stale; over 31, refused
);
// result.netZakatableWealth === "3800000.00"
// result.zakahDue === "95000.00" (if the nisab is met)
```

## Rules this package keeps

- **Amounts are decimal strings, never JS numbers.** Rounding is to the
  kobo; zakah due rounds up, in the recipients' favour.
- **Madhhab rulings are data.** A `ZakahRuleset` holds the decisions
  that differ (personal jewellery, debts, nisab basis and weights), so
  the Shariah Supervisory Board can approve or change one without a code
  change.
- **Draft rulesets can't reach a payer by accident.** `calculateZakah`
  throws `DraftRulesetError` for a draft unless the caller passes
  `{ allowDraftRuleset: true }`, which is for tests and internal
  previews only.
- **Old prices are flagged, then refused.** `result.priceFreshness` is
  `stale` once prices are over 7 days old (warn the payer), and
  `calculateZakah` throws `PricesExpiredError` past 31 days.
- **Every result records what it used**: ruleset id, version and
  approval status, plus the prices, so a stored calculation or receipt
  can always be explained later.

## Status

`draftRulesets` (Maliki, Hanafi, Shafi'i, Hanbali) are starting
proposals for the Board, not approved rulings. Approved rulesets and
prices live in the database (`zakah_rulesets`, `zakah_metal_prices`),
set through the governed actions `zakah.ruleset_approve` (proposed by a
Mutawalli Officer, approved by a Shariah board member) and
`zakah.metal_price_set` (proposed by the Investment Committee, approved
by Compliance), and are served publicly at `GET /zakah/rulesets/current`
and `GET /zakah/metal-prices/current`. Decisions still open
for the Board:

1. **Nisab basis: gold, silver or lower-of.** The most consequential
   setting. A gold-based nisab is roughly ten times a silver-based one
   in Naira, so it decides whether a payer like Amina owes anything.
2. Nisab weights: 85g / 595g, or 87.48g / 612.36g.
3. Maliki debts: deduct directly, or first against surplus
   non-zakatable property (the draft deducts directly).
4. Valuing trade goods for a long-term holder vs an active trader
   (the Maliki *muhtakir* / *mudir* distinction). The draft values all
   stock at today's selling price.

Not covered yet, by design: livestock, crops, minerals, shares,
pensions, crypto, Zakah al-Fitr, and checking the hawl (the payer
confirms they've held the wealth a full lunar year).
