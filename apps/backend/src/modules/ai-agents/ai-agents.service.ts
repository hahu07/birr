import { BadRequestException, Injectable } from "@nestjs/common";
import { IsObject, IsOptional, IsString } from "class-validator";
import { prisma, AiAgent } from "@birr/db";
import { AuditLogsService } from "../audit-logs/audit-logs.service";

export class DraftInput {
  @IsString()
  action!: string;

  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsOptional()
  @IsString()
  waqfId?: string;

  // Deliberately not a nested DTO — shape varies per agent (Nazim's
  // digest vs Rasid's report). @IsObject() is enough to survive the
  // ValidationPipe's whitelist without constraining its contents.
  @IsObject()
  draft!: unknown;
}

// Server-side, per-agent allow-list for POST /ai-agents/:name/drafts —
// deliberately not client-supplied. Even a compromised/buggy agent
// credential can only write the specific draft-action types its own
// registry row is meant to produce, never an arbitrary action/entity
// pair. Extend this only when a new agent's tier actually needs to
// persist a new kind of draft.
const ALLOWED_DRAFT_ACTIONS: Record<string, string[]> = {
  rasid: ["compliance_report.drafted"],
  nazim: ["caseload_digest.drafted"],
};

@Injectable()
export class AiAgentsService {
  constructor(private readonly auditLogs: AuditLogsService) {}

  // Registry lookups only. Agents authenticate to the backend with their
  // own scoped credentials (see common/auth/ai-agent-auth.ts) and call
  // GovernedActionsService.propose directly for maker actions — this
  // service does not itself propose or approve anything.
  findByName(name: string) {
    return prisma.aiAgent.findUniqueOrThrow({ where: { name } });
  }

  list() {
    return prisma.aiAgent.findMany({ where: { status: "active" } });
  }

  /** GET /ai-agents/:name/jurisdiction-data — Rasid's read_waqf_jurisdictions tool. */
  jurisdictionData() {
    return prisma.waqf.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, type: true, jurisdiction: true, status: true },
      orderBy: { jurisdiction: "asc" },
    });
  }

  /** GET /ai-agents/:name/case-digest-data — Nazim's caseload-triage tools. */
  async caseDigestData() {
    const [openGovernedActions, caseAssignments] = await Promise.all([
      prisma.governedAction.findMany({
        where: { status: "proposed" },
        include: { permission: { select: { key: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.waqfCaseAssignment.findMany({
        where: { status: "active" },
        orderBy: { assignedAt: "asc" },
      }),
    ]);
    return { openGovernedActions, caseAssignments };
  }

  /** POST /ai-agents/:name/drafts — shared draft-persistence path. */
  async recordDraft(agent: AiAgent, input: DraftInput) {
    const allowed = ALLOWED_DRAFT_ACTIONS[agent.name] ?? [];
    if (!allowed.includes(input.action)) {
      throw new BadRequestException(
        `Agent "${agent.name}" is not allowed to record a draft with action "${input.action}".`,
      );
    }
    return this.auditLogs.write({
      waqfId: input.waqfId,
      actorType: "ai_agent",
      actorAgentId: agent.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      after: input.draft,
    });
  }
}
