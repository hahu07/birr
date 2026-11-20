/**
 * The starting wording for Kifayah's deed (2026-11-20), from the draft for
 * Legal and the Shariah Supervisory Board ("Kifayah Waqf Deed: Draft for
 * 26 November 2026"), which replaced the need-based waqf's. A DRAFT: the
 * joint sittings of 26 November and 3 December settle its open points (D1
 * to D16 and K1 to K8 in that draft), and the approved text replaces this
 * one. Until then:
 * - clause 6(a) leaves out the maximum share of the endowment the financing
 *   fund may use (D5 is open), and 6(e) uses the recommended answer on
 *   security (D8);
 * - every other open point keeps the draft's own wording.
 * Kifayah serves Nigeria state by state, so the programme's city isn't
 * used. A Shariah board member approves each version through
 * waqf_programme.deed_approve. Staff may edit the text before drafting a
 * version; once drafted, a version's text never changes.
 */
export function draftKifayahDeedText(programme: { name: string }): string {
  return `Deed of the ${programme.name} waqf

1. Establishment. Birr establishes this waqf and is its Mutawalli (trustee). Everyone who endows into it does so as a co-founder (waqif) of what they give, by accepting this deed when they give. What is endowed can't be taken back.

2. Purpose. Kifayah means sufficiency. This waqf exists to relieve poverty among households in Nigeria whose means fall below the kifayah line of their state, so that each household reaches the line by its own means, stays above it, and decides for itself how its income and assets are used. It does this through Kifayah, Birr's graduation programme, in the states the Board of Trustees opens, giving each household, in order: support to live on, a productive asset, skills, help to save, coaching, and a measured end to support. The poorest are served first.

2A. The kifayah line. The kifayah line is the cost of a household's basic needs (food, housing, clothing, health and schooling) in its state, set for urban and rural areas where they differ. Birr sets it for each state; the Shariah Supervisory Board and the Board of Trustees approve it; it is updated for inflation. A state opens only once its line is approved.

3. Who is helped. Only households assessed as below the kifayah line under the programme's published criteria. Every household is visited at home by a field partner before it is admitted, and one person records each assessment while a different person approves it. Support never depends on anything but the published criteria. Each admitted household writes a plan with its coach, setting its own goal. There are three tiers, and a household may move between them when it is reassessed:
(a) Tier A, households furthest below the line in which someone can work: a productive asset given outright, a monthly allowance for a set period while it starts earning, training, coaching and help to save.
(b) Tier B, households nearer the line in which someone can work: a productive asset bought on easy terms (clause 6), a short allowance only if needed, training, coaching and help to save.
(c) Tier C, households in which no one can be expected to work: a monthly allowance on an approved scale, essential bills paid straight to the landlord, school, clinic or company, help in kind, and coaching. Their need is reassessed at set intervals, and support pauses if a reassessment is late.
The Board of Trustees sets the line between tiers A and B, the allowances and their length, for each state.

3A. Leaving support. Support for a household that can work lasts up to 24 months, with one extension of up to 6 months. It ends when two people agree, after a second home visit, that the household is above the kifayah line and its means will keep it there. Birr follows each household up 12 and 24 months after it leaves support. A household that falls back below the line may apply again.

4. Three pots, kept apart.
(a) The endowment: what givers endow. It is kept for ever: never spent, given away, sold for any other purpose, or pledged.
(b) The spending fund: gifts given to be spent, the endowment's income, and the financing fund's markup once the loss reserve is full. It pays for the support in clause 3 and holds the loss reserve.
(c) The financing fund: a share of the endowment, used only for murabahah and interest-free loans (clause 6). It is part of the endowment and kept for ever: what it finances comes back to it.
Money moves between the pots only as this deed says: the endowment's income to the spending fund; the share set under clause 6 between the endowment and the financing fund; markup to the loss reserve, then to the spending fund; and the loss reserve making good a written-off cost (clause 7). Birr keeps separate accounts for each pot and for the loss reserve.

5. The endowment. Endowed cash is invested only in investments the Shariah Supervisory Board has screened, and only its income is spent. Property given in kind is kept and cared for. It may be sold or exchanged only where it can no longer serve this waqf, as the Shariah Supervisory Board approves in each case, and whatever replaces it belongs to the endowment.

6. The financing fund.
(a) Its size. The Board of Trustees sets what share of the endowment the financing fund may use.
(b) Murabahah. A tier B household buys the tools or stock it needs as Birr's agent, for the waqf. Once the waqf owns them, at its own risk, Birr sells them to the household in a separate, later contract, at cost plus a markup. They pay in fixed monthly instalments. One markup rate applies to every contract, far below market rates: the Board of Trustees sets it after the Shariah Supervisory Board approves it, and reviews it every year. Once a contract is signed, its price never changes.
(c) Interest-free loans (qard hasan). For the smallest cases, the waqf lends the cost and the household repays only that, with nothing added.
(d) Through a licensed partner. Murabahah and loans are made through a partner licensed by the Central Bank of Nigeria to do so, under a written agreement with Birr, on contracts Birr's Legal Adviser and the Shariah Supervisory Board approved before use and after any change. Birr may replace the partner; the goods, the debts and the money stay the waqf's.
(e) Security. A guarantor may be asked for only where the approved partner contract requires one. The waqf never takes a charge on anyone's home, and never takes back the tools a person earns with.
(f) Savings. Birr never holds the savings of the people this waqf serves. It may help them open and use a savings account with the licensed partner, on the partner's approved contracts.

7. When payments stop. There is never a late charge of any kind, including one paid to charity, since raising what is owed for lateness would be riba. Birr first visits and talks with the household. If the cause is hardship, two people may approve a new schedule, with nothing added. Writing a debt off is a last resort, approved by the Board of Trustees. A written-off cost is made good from the loss reserve, never from the endowment. Markup fills the loss reserve first, up to a level the Board of Trustees sets. If the reserve is empty, no new financing is made until it is refilled.

8. Equipment. The waqf never lends or leases equipment. Tools and stock are given outright (tier A), sold by murabahah or bought with an interest-free loan (tier B), always for the household to own. Tools given outright come from the spending fund or from zakah, never from the endowment or the financing fund.

9. Zakah stays outside this waqf. Zakah given for Kifayah's households is held by Birr as each payer's agent, in its own pool, never in any of the three pots, and used only for households Kifayah has admitted and assessed as poor or needy: their allowances, essential and medical bills, assets given to them outright, and the debts of those overwhelmed by debt. It becomes theirs (tamlik) when paid to them, or paid for them with their written authorisation. It never pays for murabahah, loans, training, coaching or any cost of running the programme. Where zakah may pay, it is used before the spending fund.

10. People helped and their records. Birr collects only what the assessment needs, with each person's consent in their own language, tells them what it holds and why, and keeps their bank details encrypted. Payments go only to an account in the person's own name; changing it needs a second person's approval. A refused applicant is told why and may appeal to someone who took no part in the decision. Records are kept for 6 years after a household's support or last payment ends, then deleted, under the Nigeria Data Protection Act 2023. No one helped is ever named or shown publicly without their own written consent, which they may withdraw.

11. Costs. The spending fund may pay the agreed fees of the licensed partner, field partners, training providers and coaches for this waqf, licensed health providers' bills for the households it serves, and third-party costs tied to one household, such as an identity check. It never pays Birr's own costs of running the platform. Birr takes no fee as Mutawalli.

12. Gifts made by mistake. A gift paid twice, for the wrong amount, or without the payer's authority is not endowed, and may be returned. A gift is never returned because the giver changed their mind.

13. Reports. Birr has the waqf's accounts audited each year and reports to supporters every month, for each state: how many households each tier supports; allowances and bills paid; assets given; financing made and repaid on time; debts written off; how far below the kifayah line the households served are; how many left support above the line; how many were still above it 12 and 24 months after leaving; and how many reached the goal in their plan.

14. If the purpose can't be served. If this purpose can no longer be served in Nigeria, the endowment and the financing fund serve the closest purpose the Shariah Supervisory Board approves. Debts already owed are still collected on their signed terms, and with the same kindness.

15. Changes to this deed. A new version of this deed applies only once Birr's Legal Adviser has reviewed it and a Shariah Supervisory Board member approves it. No version may change the purpose, the three pots, the endowment being kept for ever, or the rule against any late charge, and none changes a contract already signed.

16. The name. This waqf is called Kifayah, Arabic for sufficiency: enough to live with dignity, by one's own means. Birr may use the name, with "by Birr" or without, for this waqf and its programme alone.`;
}
