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

interface VerifyChainIssue {
  sequence: number;
  id: string;
  issue: string;
}

interface VerifyChainResult {
  ok: boolean;
  totalRecords: number;
  issues: VerifyChainIssue[];
}

const CHAIN_RECORD_INCLUDE = {
  actorUser: { select: { id: true, fullName: true, email: true } },
  actorAgent: { select: { id: true, name: true } },
  actorFounder: { select: { id: true, name: true } },
} as const;

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

  /**
   * Recomputes the hash chain (see the add_audit_log_hash_chain
   * migration's audit_logs_verify_chain() function — this calls that,
   * not a reimplementation, so there's no risk of the two formulas
   * drifting apart) and reports any row whose stored hash no longer
   * matches its current content or its declared link to the prior row.
   * An empty issues list means the chain is intact end to end.
   */
  async verifyChain(): Promise<VerifyChainResult> {
    const [issues, totalRecords] = await Promise.all([
      prisma.$queryRaw<VerifyChainIssue[]>`
        SELECT sequence, id, issue FROM audit_logs_verify_chain()
      `,
      prisma.auditLog.count(),
    ]);

    return { ok: issues.length === 0, totalRecords, issues };
  }

  /**
   * Full compliance export for the Audit Committee / External Auditor —
   * every record in chain order, with the hash fields attached so the
   * export itself can be independently re-verified later even outside
   * this system.
   */
  async exportChain(filters?: { waqfId?: string }) {
    const records = await prisma.auditLog.findMany({
      where: filters?.waqfId ? { waqfId: filters.waqfId } : undefined,
      orderBy: { sequence: "asc" },
      include: CHAIN_RECORD_INCLUDE,
    });

    const chainHead = records.length > 0 ? records[records.length - 1]! : null;

    return {
      exportedAt: new Date().toISOString(),
      totalRecords: records.length,
      chainHeadSequence: chainHead ? chainHead.sequence : null,
      chainHeadHash: chainHead ? chainHead.recordHash : null,
      records,
    };
  }
}
