/**
 * The starting wording for a need-based waqf's deed (2026-11-18), from the
 * draft for Legal and the Shariah Supervisory Board ("Need-Based Waqf Deed,
 * draft", 18 November 2026). A DRAFT: the joint sittings of 26 November and
 * 3 December settle its open points (D1 to D17 in that draft), and the
 * approved text replaces this one. Until then:
 * - clause 6(a) leaves out the maximum share of the endowment the financing
 *   fund may use (D5 is open), and 6(e) uses the recommended answer on
 *   security (D8);
 * - every other open point keeps the draft's own wording.
 * A Shariah board member approves each version through
 * waqf_programme.deed_approve. Staff may edit the text before drafting a
 * version; once drafted, a version's text never changes.
 */
export function draftNeedBasedDeedText(programme: { name: string; city: string }): string {
  return `Deed of the ${programme.name} waqf

1. Establishment. Birr establishes this waqf and is its Mutawalli (trustee). Everyone who endows into it does so as a co-founder (waqif) of what they give, by accepting this deed when they give. What is endowed can't be taken back.

2. Purpose. To relieve poverty among households in ${programme.city} whose means fall below the kifayah line: helping those who can work to earn their own living, and supporting those who can't with what they need to live with dignity. The poorest are served first. The kifayah line is the cost of a household's basic needs (food, housing, health and schooling) in ${programme.city}. Birr sets it, the Shariah Supervisory Board and the Board of Trustees approve it, and it is updated for inflation.

3. Who is helped. Only households assessed as below the kifayah line. One person records each assessment and a different person approves it before any support starts. Support never depends on anything but the published criteria. There are two tracks, and a person may move between them:
(a) The productive track, for people who can work: training, tools and stock bought on easy terms (clause 6), and tools given outright.
(b) The other track, for people who can't be expected to earn: a monthly allowance on an approved scale, essential bills paid straight to the landlord, school, clinic or company, and help in kind. Each person's need is reassessed at set intervals, and support pauses if a reassessment is late.

4. Three pots, kept apart.
(a) The endowment: what givers endow. It is kept for ever: never spent, given away, sold for any other purpose, or pledged.
(b) The spending fund: gifts given to be spent, the endowment's income, and the financing fund's markup once the loss reserve is full. It pays for the support in clause 3 and holds the loss reserve.
(c) The financing fund: a share of the endowment, used only for murabahah and interest-free loans (clause 6). It is part of the endowment and kept for ever: what it finances comes back to it.
Money moves between the pots only as this deed says: the endowment's income to the spending fund; the share set under clause 6 between the endowment and the financing fund; markup to the loss reserve, then to the spending fund; and the loss reserve making good a written-off cost (clause 7). Birr keeps separate accounts for each pot and for the loss reserve.

5. The endowment. Endowed cash is invested only in investments the Shariah Supervisory Board has screened, and only its income is spent. Property given in kind is kept and cared for. It may be sold or exchanged only where it can no longer serve this waqf, as the Shariah Supervisory Board approves in each case, and whatever replaces it belongs to the endowment.

6. The financing fund.
(a) Its size. The Board of Trustees sets what share of the endowment the financing fund may use.
(b) Murabahah. A person on the productive track buys the tools or stock they need as Birr's agent, for the waqf. Once the waqf owns them, at its own risk, Birr sells them to the person in a separate, later contract, at cost plus a markup. They pay in fixed monthly instalments. One markup rate applies to every contract, far below market rates: the Board of Trustees sets it after the Shariah Supervisory Board approves it, and reviews it every year. Once a contract is signed, its price never changes.
(c) Interest-free loans (qard hasan). For the poorest or smallest cases, the waqf lends the cost and the person repays only that, with nothing added.
(d) Through a licensed partner. Murabahah and loans are made through a partner licensed by the Central Bank of Nigeria to do so, under a written agreement with Birr, on contracts Birr's Legal Adviser and the Shariah Supervisory Board approved before use and after any change. Birr may replace the partner; the goods, the debts and the money stay the waqf's.
(e) Security. A guarantor may be asked for only where the approved partner contract requires one. The waqf never takes a charge on anyone's home, and never takes back the tools a person earns with.

7. When payments stop. There is never a late charge of any kind, including one paid to charity, since raising what is owed for lateness would be riba. Birr first visits and talks with the person. If the cause is hardship, two people may approve a new schedule, with nothing added. Writing a debt off is a last resort, approved by the Board of Trustees. A written-off cost is made good from the loss reserve, never from the endowment. Markup fills the loss reserve first, up to a level the Board of Trustees sets. If the reserve is empty, no new financing is made until it is refilled.

8. Equipment. The waqf never lends or leases equipment. Tools and stock are sold by murabahah, bought with an interest-free loan, or given outright, always for the person to own. Tools given outright come from the spending fund or from zakah, never from the endowment or the financing fund.

9. Zakah stays outside this waqf. Zakah given for the people this waqf serves is held by Birr as the payer's agent, never in any of the three pots. It is paid only for people assessed as poor or needy: their allowances and bills, tools given to them outright, and the debts of those overwhelmed by debt. It never pays for murabahah or loans.

10. People helped and their records. Birr collects only what the assessment needs, tells each person what it holds and why, and keeps their bank details encrypted. Changing someone's bank details needs a second person's approval. Records are kept for 6 years after a person's support or last payment ends, then deleted, under the Nigeria Data Protection Act 2023. No one helped is ever named or shown publicly.

11. Costs. The spending fund may pay the licensed partner's and field partners' agreed fees for this waqf. Birr takes no fee as Mutawalli.

12. Gifts made by mistake. A gift paid twice, for the wrong amount, or without the payer's authority is not endowed, and may be returned. A gift is never returned because the giver changed their mind.

13. Reports. Birr has the waqf's accounts audited each year and reports to supporters every month: how many people each track supports, allowances paid, financing made and repaid on time, debts written off, and how far below the kifayah line the people served are.

14. If the purpose can't be served. If this purpose can no longer be served in ${programme.city}, the endowment and the financing fund serve the closest purpose the Shariah Supervisory Board approves: the relief of poor households elsewhere in Nigeria. Debts already owed are still collected on their signed terms, and with the same kindness.

15. Changes to this deed. A new version of this deed applies only once Birr's Legal Adviser has reviewed it and a Shariah Supervisory Board member approves it. No version may change the purpose, the three pots, the endowment being kept for ever, or the rule against any late charge, and none changes a contract already signed.`;
}
