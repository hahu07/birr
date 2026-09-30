import { Injectable, Logger } from "@nestjs/common";
import { prisma, FunnelName, Prisma } from "@birr/db";

// The canonical, ordered shape of each funnel — not every step a
// visitor could theoretically hit, just the ones this codebase actually
// records (see this module's controller/other services' own record()
// call sites). report() below walks these in order rather than however
// groupBy happens to return rows, so a step with zero events still
// shows as a real zero in its place rather than silently vanishing from
// the report.
const FOUNDER_STEP_ORDER = [
  "signup_started",
  "signup_completed",
  "foundation_created",
  "deed_signed",
  "waqf_fund_created",
] as const;
const VAULT_STEP_ORDER = ["page_viewed", "checkout_started", "contribution_initiated", "contribution_confirmed"] as const;

export interface FunnelStepCount {
  step: string;
  count: number;
}

export interface FunnelReport {
  founder: FunnelStepCount[];
  vault: FunnelStepCount[];
}

export interface RecordFunnelEventInput {
  funnel: FunnelName;
  step: string;
  // Not a literal browser session for a backend-driven event — see
  // this class's own doc comment on record(). Whatever the caller
  // passes, it's the best available handle for grouping this event
  // with the others belonging to the same actor.
  sessionId: string;
  founderId?: string;
  waqfId?: string;
  vaultId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Lightweight, append-only instrumentation for the Founder-establishment
 * and Vault-giving funnels — see FunnelEvent's own schema comment. This
 * is analytics only: it never gates a real action, never throws into a
 * caller's own transaction, and carries no maker-checker weight.
 *
 * record() is meant to be called two ways:
 *   - Fire-and-forget, right after another service's own transaction
 *     commits a real milestone (a Foundation created, a deed signed) —
 *     same "best-effort, outside the transaction" posture as every
 *     other post-commit side effect in this codebase (email sends,
 *     notify() fan-outs). sessionId for these calls is the most durable
 *     identifier already on hand (a founderId, a donorId) — there's no
 *     browser session to thread through a signed-in backend write.
 *   - Via FunnelEventsController, for steps with no database row of
 *     their own yet (a page viewed, a checkout started) — sessionId
 *     there really is a client-generated, anonymous, per-browser id.
 */
@Injectable()
export class FunnelEventsService {
  private readonly logger = new Logger(FunnelEventsService.name);

  async record(input: RecordFunnelEventInput): Promise<void> {
    try {
      await prisma.funnelEvent.create({
        data: {
          funnel: input.funnel,
          step: input.step,
          sessionId: input.sessionId,
          founderId: input.founderId,
          waqfId: input.waqfId,
          vaultId: input.vaultId,
          metadata: input.metadata,
        },
      });
    } catch (err) {
      // Never let an analytics write turn a real, successful action
      // into an error response for the caller.
      this.logger.error(
        `Failed to record funnel event "${input.funnel}.${input.step}":`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  // Staff-side report — plain counts per step, oldest-step-first, so
  // the caller can read off both the absolute numbers and the drop-off
  // between adjacent steps. Deliberately not deduplicated by sessionId
  // (a signup_started counted twice for the same visitor — e.g. React
  // dev-mode's double effect fire, or someone reloading the form — is
  // an honest reflection of "the event landed twice," not something
  // this report tries to paper over into a false single-visitor count).
  async report(since?: Date): Promise<FunnelReport> {
    const grouped = await prisma.funnelEvent.groupBy({
      by: ["funnel", "step"],
      _count: { _all: true },
      where: since ? { occurredAt: { gte: since } } : undefined,
    });
    const countFor = (funnel: FunnelName, step: string) =>
      grouped.find((g) => g.funnel === funnel && g.step === step)?._count._all ?? 0;

    return {
      founder: FOUNDER_STEP_ORDER.map((step) => ({ step, count: countFor("founder", step) })),
      vault: VAULT_STEP_ORDER.map((step) => ({ step, count: countFor("vault", step) })),
    };
  }
}
