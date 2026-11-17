import { once } from "events";
import type { Writable } from "stream";
import { Injectable } from "@nestjs/common";
import { prisma, ActorType, Prisma } from "@birr/db";

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
   *
   * Since 2026-11-17 it never loads the whole trail at once (70,500 rows
   * in a long-used dev database, and production only grows): the plan
   * fixes the chain head and the count up front, then the rows are read
   * in pages of EXPORT_PAGE_SIZE by sequence and streamed out
   * (streamChainExport). Rows written while an export runs come after the
   * head, so they're left out and the file stays one consistent snapshot.
   */
  async planChainExport(filters?: { waqfId?: string }): Promise<ChainExportPlan> {
    const where = chainExportWhere(filters);
    const head = await prisma.auditLog.findFirst({ where, orderBy: { sequence: "desc" }, select: { sequence: true, recordHash: true } });
    const totalRecords = head ? await prisma.auditLog.count({ where: { ...where, sequence: { lte: head.sequence } } }) : 0;
    return {
      exportedAt: new Date().toISOString(),
      totalRecords,
      chainHeadSequence: head ? head.sequence : null,
      chainHeadHash: head ? head.recordHash : null,
    };
  }

  /** The plan's records in chain order, a page at a time. */
  async *chainExportPages(plan: ChainExportPlan, filters?: { waqfId?: string }, pageSize = EXPORT_PAGE_SIZE) {
    if (plan.chainHeadSequence === null) return;
    let after: number | null = null;
    for (;;) {
      const page: ChainExportRecord[] = await prisma.auditLog.findMany({
        where: { ...chainExportWhere(filters), sequence: { lte: plan.chainHeadSequence, ...(after !== null ? { gt: after } : {}) } },
        orderBy: { sequence: "asc" },
        take: pageSize,
        include: CHAIN_RECORD_INCLUDE,
      });
      if (page.length > 0) yield page;
      if (page.length < pageSize) return;
      after = page[page.length - 1]!.sequence;
    }
  }

  /**
   * Writes the export as JSON to `out` (an HTTP response): the plan's
   * fields, then "records", one record per line. Same shape as the export
   * always had, so a file can still be verified the same way. Waits for
   * `out` to drain when it's full, so memory stays at one page.
   */
  async streamChainExport(out: Writable, plan: ChainExportPlan, filters?: { waqfId?: string }, pageSize = EXPORT_PAGE_SIZE): Promise<void> {
    const write = async (chunk: string) => {
      if (!out.write(chunk)) await once(out, "drain");
    };
    const header = JSON.stringify(plan);
    await write(`${header.slice(0, -1)},"records":[`);
    let separator = "\n";
    for await (const page of this.chainExportPages(plan, filters, pageSize)) {
      let chunk = "";
      for (const record of page) {
        chunk += `${separator}${JSON.stringify(record)}`;
        separator = ",\n";
      }
      await write(chunk);
    }
    await write("\n]}\n");
  }
}

export const EXPORT_PAGE_SIZE = 1000;

export type ChainExportRecord = Prisma.AuditLogGetPayload<{ include: typeof CHAIN_RECORD_INCLUDE }>;

export interface ChainExportPlan {
  exportedAt: string;
  totalRecords: number;
  chainHeadSequence: number | null;
  chainHeadHash: string | null;
}

function chainExportWhere(filters?: { waqfId?: string }) {
  return filters?.waqfId ? { waqfId: filters.waqfId } : {};
}
