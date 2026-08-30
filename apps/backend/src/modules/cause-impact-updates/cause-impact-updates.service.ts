import { Injectable, NotFoundException } from "@nestjs/common";
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { prisma } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveFounderRecipientUserIdsForWaqf } from "../../common/notifications/resolve-founder-recipients";

const PERIOD_LABEL_MAX_LENGTH = 40;
const NARRATIVE_MAX_LENGTH = 2000;
const METRIC_LABEL_MAX_LENGTH = 40;

export class CreateCauseImpactUpdateInput {
  @IsString()
  waqfCauseId!: string;

  @IsString()
  @IsNotEmpty({ message: "A period label is required, e.g. \"Q1 2026\"." })
  @MaxLength(PERIOD_LABEL_MAX_LENGTH)
  periodLabel!: string;

  @IsString()
  @IsNotEmpty({ message: "A narrative is required." })
  @MaxLength(NARRATIVE_MAX_LENGTH)
  narrative!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  metricValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(METRIC_LABEL_MAX_LENGTH)
  metricLabel?: string;
}

const IMPACT_INCLUDE = {
  reportedByUser: { select: { id: true, fullName: true } },
} as const;

@Injectable()
export class CauseImpactUpdatesService {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Birr-staff only — see the schema's own comment on why this is
  // append-only (no update/update route at all). Plain CRUD, not
  // governed_actions, same posture as every other Cause-adjacent write
  // in this feature: organizational/reporting content, not a fiduciary
  // act on a specific waqf's assets.
  async create(input: CreateCauseImpactUpdateInput, actorUserId: string) {
    const waqfCause = await prisma.waqfCause.findUnique({ where: { id: input.waqfCauseId } });
    if (!waqfCause) throw new NotFoundException(`WaqfCause "${input.waqfCauseId}" not found.`);

    const update = await prisma.$transaction(async (tx) => {
      const update = await tx.causeImpactUpdate.create({
        data: {
          waqfCauseId: input.waqfCauseId,
          reportedByUserId: actorUserId,
          periodLabel: input.periodLabel.trim(),
          narrative: input.narrative.trim(),
          metricValue: input.metricValue,
          metricLabel: input.metricLabel?.trim() || undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          waqfId: waqfCause.waqfId,
          actorType: "birr_staff",
          actorUserId,
          action: "cause_impact_update.created",
          entityType: "CauseImpactUpdate",
          entityId: update.id,
          after: update as any,
        },
      });
      return update;
    });

    // Deliberately NOT awaited — see the established fire-and-forget
    // posture for every post-transaction notify() fan-out this session.
    this.notifyFounders(waqfCause.waqfId, waqfCause.name, update.id).catch((err) => {
      console.error(`Failed to notify founders of impact update "${update.id}":`, err);
    });

    return update;
  }

  private async notifyFounders(waqfId: string, causeName: string, updateId: string): Promise<void> {
    const recipientUserIds = await resolveFounderRecipientUserIdsForWaqf(waqfId);
    await Promise.all(
      recipientUserIds.map((userId) =>
        this.notificationsService.notify({
          recipientType: "founder_user",
          recipientUserId: userId,
          type: "cause_impact_update.logged",
          title: `New impact update — ${causeName}`,
          body: `A new impact update was logged for ${causeName}.`,
          linkUrl: `/portfolio/${waqfId}`,
          relatedEntityType: "CauseImpactUpdate",
          relatedEntityId: updateId,
        }),
      ),
    );
  }

  list(waqfCauseId: string) {
    return prisma.causeImpactUpdate.findMany({
      where: { waqfCauseId },
      orderBy: { createdAt: "desc" },
      include: IMPACT_INCLUDE,
    });
  }

  /**
   * Founder-Portal read path — same ownership-check shape as
   * WaqfCausesService.listForFounder: confirms the cause's own waqf
   * actually belongs to this founder before returning anything, via the
   * founder_isolation RLS policy (withFounderScope). Returns null (not a
   * thrown error) so the controller can 404 — indistinguishable from "id
   * doesn't exist," never confirming another Founder's cause.
   */
  async listForFounder(waqfCauseId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const waqfCause = await tx.waqfCause.findFirst({
        where: { id: waqfCauseId, waqf: { foundation: { foundationFounders: { some: { founderId } } } } },
        select: { id: true },
      });
      if (!waqfCause) return null;
      return tx.causeImpactUpdate.findMany({
        where: { waqfCauseId },
        orderBy: { createdAt: "desc" },
        include: IMPACT_INCLUDE,
      });
    });
  }

  /**
   * Founder-Portal read path — every impact update across every waqf
   * this founder actually owns, for the standalone Impact page (not
   * scoped to one waqf's detail view, unlike listForFounder above). Same
   * founder_isolation RLS scoping via withFounderScope.
   */
  async listAllForFounder(founderId: string) {
    return withFounderScope(founderId, (tx) =>
      tx.causeImpactUpdate.findMany({
        where: { waqfCause: { waqf: { foundation: { foundationFounders: { some: { founderId } } } } } },
        orderBy: { createdAt: "desc" },
        include: {
          ...IMPACT_INCLUDE,
          waqfCause: { select: { id: true, name: true, waqf: { select: { id: true, name: true } } } },
        },
      }),
    );
  }
}
