import { Logger } from "@nestjs/common";

const logger = new Logger("DevSendFallback");

/**
 * Every Resend adapter (founders/email, invitations/email,
 * notifications/email) fails loudly when Resend isn't configured — a
 * deliberate choice (see docker-compose.yml's backend service comment:
 * "fails loudly ... rather than silently") so a real deployment never
 * silently pretends an email went out. That same fail-loud behavior
 * makes ordinary local development impossible without live Resend
 * credentials, though, so outside a real deployment we log what would
 * have been sent instead of throwing — this is what draws that line.
 *
 * docker-compose.yml's backend service explicitly sets
 * NODE_ENV=production; nothing in local `pnpm dev` sets NODE_ENV at
 * all, so this is false there without any extra local config.
 */
export function inRealDeployment(): boolean {
  return process.env.NODE_ENV === "production";
}

export function logDevEmailFallback(kind: string, to: string, body: string): void {
  logger.warn(`[dev-only] Resend isn't configured — ${kind} to ${to} was NOT actually sent.\n${body}`);
}
