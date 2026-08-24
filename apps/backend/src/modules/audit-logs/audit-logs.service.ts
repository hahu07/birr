import { Injectable } from "@nestjs/common";
import { prisma, ActorType } from "@birr/db";

interface WriteAuditLogInput {
  waqfId?: string;
  actorType: ActorType;
  actorUserId?: string; // set for birr_staff / founder_user
  actorAgentId?: string; // set for ai_agent
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}

@Injectable()
export class AuditLogsService {
  /**
   * Called from every other service's write path — never skip this.
   * audit_logs is insert-only at the DB role level (see the manual
   * migration); this service should never attempt an update or delete.
   */
  async write(input: WriteAuditLogInput) {
    return prisma.auditLog.create({
      data: {
        waqfId: input.waqfId,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        actorAgentId: input.actorAgentId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before as any,
        after: input.after as any,
        ipAddress: input.ipAddress,
      },
    });
  }
}
