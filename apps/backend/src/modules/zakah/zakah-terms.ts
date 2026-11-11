/**
 * The agency (wakalah) appointment a payer accepts before paying zakah
 * through Birr. Birr receives zakah as each payer's agent, not as its own
 * money or as a trustee, so this is what authorises Birr to distribute it.
 *
 * DRAFT wording — Legal and the Shariah Supervisory Board must approve it
 * before zakah payments open. Changing the text means a new `version`:
 * each ZakahPayment stores the version its payer accepted, and the server
 * refuses a payment that accepted anything other than the current one.
 */
export const ZAKAH_WAKALAH_TERMS = {
  version: "2026-11-11-draft",
  text:
    "I appoint Birr (Incorporated Trustees, registered in Nigeria) as my agent (wakil) to receive this payment as my zakah " +
    "and to distribute it on my behalf, only to people eligible to receive zakah under the eight categories named in " +
    "Qur'an 9:60, as determined by Birr's Shariah Supervisory Board. Birr will not use my zakah for its own running costs. " +
    "Once Birr has distributed my zakah, it can't be returned.",
} as const;

/**
 * The smallest zakah payment accepted. Not ContributionMinimum: that's a
 * waqf-funding floor (around ₦150,000), far above what someone just over
 * the nisab owes. Any amount of zakah is valid; this only keeps out
 * payments too small to be worth a processing fee.
 */
export const ZAKAH_MINIMUM_PAYMENT_NGN = "100";
