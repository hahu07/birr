import { createHmac, timingSafeEqual } from "crypto";

/**
 * Shared by both Paystack adapters (contributions/providers/paystack.adapter.ts
 * for inbound charges, distributions/providers/paystack-payout.adapter.ts
 * for outbound transfers) — both event families arrive at the same
 * POST /webhooks/paystack route (Paystack supports only one webhook URL
 * per account) and are signed identically: HMAC-SHA512 over the raw
 * body, keyed by the account's secret key itself, not a separate
 * webhook secret. Extracted here once both adapters needed it, rather
 * than duplicated, so a future fix to this check can't drift between
 * the two call sites.
 */
export function verifyPaystackSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secretKey: string | undefined | null,
): boolean {
  if (!signature || !secretKey) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const signatureBuf = Buffer.from(signature, "hex");
  return expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf);
}
