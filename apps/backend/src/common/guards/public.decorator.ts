import { SetMetadata } from "@nestjs/common";

/**
 * Opts a route (or an entire controller) out of SessionAuthGuard's
 * default-deny requirement that every request carry a valid Birr-staff
 * session. Two legitimate reasons a route needs this:
 *   - It's genuinely public with no auth at all (a payment-provider
 *     webhook verified by its own signature, an invitation-acceptance
 *     route where the token itself is the credential).
 *   - It's authenticated a different way — the Founder Portal's
 *     self-service surface checks resolveFounderFromSession() itself,
 *     which is a separate identity type (Founder/User) from BirrStaff,
 *     not "no auth."
 * See SessionAuthGuard for the class this pairs with.
 */
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
