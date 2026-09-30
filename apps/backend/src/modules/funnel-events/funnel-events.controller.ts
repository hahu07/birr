import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { prisma, FunnelName, Prisma } from "@birr/db";
import { FunnelEventsService } from "./funnel-events.service";
import { Public } from "../../common/guards/public.decorator";

const METADATA_MAX_BYTES = 2_000;

// Only these funnel/step pairs may be reported from the client — this
// endpoint has no session of any kind to authenticate against
// (page-view-shaped, by design), so it's the allow-list below, not
// auth, that stops it being used to fabricate steps that should only
// ever come from a real backend milestone (e.g. "waqf_fund_created").
// Every step below has no database row of its own at the moment it
// happens — see FunnelEvent's own schema comment.
const ALLOWED_CLIENT_STEPS: Record<FunnelName, string[]> = {
  founder: ["signup_started"],
  vault: ["page_viewed", "checkout_started"],
};

export class RecordFunnelEventInput {
  @IsIn(["founder", "vault"])
  funnel!: FunnelName;

  @IsString()
  @MaxLength(64)
  step!: string;

  @IsString()
  @MaxLength(128)
  sessionId!: string;

  @IsOptional()
  @IsString()
  vaultId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

@Controller("funnel-events")
export class FunnelEventsController {
  constructor(private readonly service: FunnelEventsService) {}

  // Public, unauthenticated, deliberately tight — this is a
  // fire-and-forget beacon call from a page render or a button click,
  // never something a legitimate client calls often per session.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Public()
  @Post()
  async record(@Body() body: RecordFunnelEventInput) {
    const allowedSteps = ALLOWED_CLIENT_STEPS[body.funnel];
    if (!allowedSteps?.includes(body.step)) {
      throw new BadRequestException(`"${body.step}" isn't a reportable step for the ${body.funnel} funnel.`);
    }
    if (body.metadata && Buffer.byteLength(JSON.stringify(body.metadata), "utf8") > METADATA_MAX_BYTES) {
      throw new BadRequestException(`metadata must be under ${METADATA_MAX_BYTES} bytes.`);
    }

    let vaultId: string | undefined;
    if (body.vaultId) {
      const vault = await prisma.vault.findUnique({ where: { id: body.vaultId }, select: { id: true } });
      if (!vault) throw new BadRequestException(`Unknown vault "${body.vaultId}".`);
      vaultId = vault.id;
    }

    await this.service.record({
      funnel: body.funnel,
      step: body.step,
      sessionId: body.sessionId,
      vaultId,
      metadata: body.metadata as Prisma.InputJsonValue | undefined,
    });
    return { ok: true };
  }

  // Staff-only — no @Public() here, so this falls under the default
  // SessionAuthGuard floor (any signed-in birr_staff), same plain-
  // viewing posture as e.g. AuditLogsController.list(): a report, not a
  // sensitive or money-moving action, so no RequiresStaffRole gate.
  @Get("report")
  async report(@Query("since") since?: string) {
    let sinceDate: Date | undefined;
    if (since) {
      sinceDate = new Date(since);
      if (Number.isNaN(sinceDate.getTime())) {
        throw new BadRequestException(`"${since}" isn't a valid date.`);
      }
    }
    return this.service.report(sinceDate);
  }
}
