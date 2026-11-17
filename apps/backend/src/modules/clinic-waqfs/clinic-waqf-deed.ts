import { createHash } from "crypto";

/**
 * The starting wording for a clinic waqf's deed (2026-11-17), from the
 * owner's decisions. A DRAFT: Legal and the Shariah Supervisory Board must
 * approve it, and a Shariah board member approves each version through
 * clinic_waqf.deed_approve. Staff may edit the text before drafting a
 * version; once drafted, a version's text never changes.
 */
export function draftClinicDeedText(clinic: { name: string; city: string }): string {
  return `Deed of the ${clinic.name} waqf

1. Establishment. Birr establishes this waqf and is its Mutawalli (trustee). Everyone who endows into it does so as a co-founder (waqif) of what they give, by accepting this deed when they give.

2. Purpose. To provide laboratory and clinic care, in ${clinic.city}, for women, and for children up to the age set by the Shariah Supervisory Board, giving priority to those who cannot afford it. The clinic does not deliver babies; it refers births to a hospital.

3. Two pots, kept apart.
(a) The endowment: the premises, the equipment, and money invested for income. It is kept for ever. It is never spent, given away, sold for any other purpose, or pledged.
(b) The running fund: gifts given to be spent, and the endowment's income. It pays for subsidised visits and the clinic's running costs.
Money in one pot never moves to the other. Zakah is never part of the endowment; zakah received for patients pays only the bills of patients assessed as poor or needy.

4. Running the clinic. A licensed healthcare operator runs the clinic under a written agreement with Birr. Birr does not practise medicine. Birr may replace the operator; the endowment stays with the waqf.

5. Replacing the endowment's property. Worn-out equipment may be replaced, and the premises exchanged or moved only where the clinic can no longer serve its purpose there, in each case as the Shariah Supervisory Board approves. Whatever replaces them belongs to the endowment.

6. If the clinic cannot continue. If this purpose can no longer be served in ${clinic.city}, the endowment serves the closest purpose the Shariah Supervisory Board approves: the health of women and children elsewhere.

7. Accounts. Birr keeps separate accounts for the two pots, has them audited each year, and reports to supporters every month.

8. Changes to this deed. A new version of this deed applies only once a Shariah Supervisory Board member approves it, and never changes the purpose, the two pots, or the endowment being kept for ever.`;
}

/** sha256 of the text, hex — the same value the database checks. */
export function deedTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
