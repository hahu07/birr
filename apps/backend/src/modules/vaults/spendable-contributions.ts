import { Prisma } from "@birr/db";

/**
 * Contributions whose money Birr actually holds and may commit: confirmed,
 * not under a compliance hold, and not being or already refunded (a
 * *failed* refund means the money never left, so it still counts).
 *
 * Every figure that feeds a spending decision or a public "raised" total
 * must use this, never a bare `status: "confirmed"` — `refundStatus` and
 * `heldAt` are separate columns, so a refunded or AML-held gift is still
 * "confirmed" underneath. Counting it overstated the public progress bar,
 * let staff allocate and pay out money already returned to its donor, and
 * made a compliance hold freeze nothing. The AML threshold and structuring
 * review deliberately do NOT use this: a refunded gift is still part of a
 * donor's giving history.
 */
export const SPENDABLE_CONTRIBUTION_WHERE = {
  status: "confirmed",
  heldAt: null,
  OR: [{ refundStatus: null }, { refundStatus: "failed" }],
} satisfies Prisma.VaultContributionWhereInput;
