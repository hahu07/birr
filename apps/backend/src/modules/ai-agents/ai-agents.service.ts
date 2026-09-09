import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsObject, IsOptional, IsString } from "class-validator";
import { prisma, AiAgent } from "@birr/db";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedBirrStaff } from "../../common/auth/current-birr-staff";

// Never select apiKeyHash onto a response body — same principle as
// BirrStaffService's SAFE_USER_SELECT for User.passwordHash. list() had
// been returning it unselected (a plain findMany with no `select`)
// straight to the Ops Console's browser.
const SAFE_AGENT_SELECT = {
  id: true,
  name: true,
  taskType: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
  bashir: ["content.drafted"],
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

  // CLAUDE.md's graduation gate ("officers consistently act on its
  // drafts without correcting them") is a qualitative call a human makes
  // — nothing here decides it automatically. What this *can* surface
  // honestly: how many drafts an agent has actually produced, how many
  // governed_actions it's actually proposed (0 for every agent today —
  // none has graduated), and when it last did anything at all. Real
  // signal an officer can look at, not a fabricated readiness score.
  async list() {
    const agents = await prisma.aiAgent.findMany({ where: { status: "active" }, select: SAFE_AGENT_SELECT });
    const agentIds = agents.map((a) => a.id);
    if (agentIds.length === 0) return agents.map((a) => ({ ...a, draftCount: 0, governedActionCount: 0, lastActiveAt: null }));

    const [draftStats, governedActionCounts] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ["actorAgentId"],
        where: { actorType: "ai_agent", actorAgentId: { in: agentIds } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.governedAction.groupBy({
        by: ["makerAgentId"],
        where: { makerType: "ai_agent", makerAgentId: { in: agentIds } },
        _count: { _all: true },
      }),
    ]);
    const draftStatsById = new Map(draftStats.map((d) => [d.actorAgentId, d]));
    const governedActionCountById = new Map(governedActionCounts.map((g) => [g.makerAgentId, g._count._all]));

    return agents.map((agent) => ({
      ...agent,
      draftCount: draftStatsById.get(agent.id)?._count._all ?? 0,
      governedActionCount: governedActionCountById.get(agent.id) ?? 0,
      lastActiveAt: draftStatsById.get(agent.id)?._max.createdAt ?? null,
    }));
  }

  // Staff-facing detail behind the registry list above — the actual
  // draft content an agent has produced (audit_logs rows this same
  // agent wrote via recordDraft), most recent first. This is what makes
  // "draft-only" mean something concrete: an officer can read exactly
  // what Rasid/Nazim have been drafting, not just a status label.
  drafts(agentId: string) {
    return prisma.auditLog.findMany({
      where: { actorType: "ai_agent", actorAgentId: agentId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
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

  /**
   * POST /ai-agents/bashir/drafts/:draftId/publish — the one publish
   * path in this codebase (Bashir is the only agent CLAUDE.md requires
   * this for: "never auto-publishes... published output should still
   * write to audit_logs"). Staff-session-authenticated, role-gated to
   * legal_adviser/compliance_officer at the controller
   * (@RequiresStaffRole) — this method trusts that gate already ran and
   * focuses on the draft-state checks only a lookup can answer.
   */
  async publishDraft(draftId: string, staff: AuthenticatedBirrStaff) {
    const draft = await prisma.auditLog.findUnique({ where: { id: draftId } });
    if (!draft || draft.actorType !== "ai_agent" || !draft.actorAgentId || draft.action !== "content.drafted") {
      throw new NotFoundException("No matching Bashir draft found.");
    }
    const agent = await prisma.aiAgent.findUnique({ where: { id: draft.actorAgentId } });
    if (!agent || agent.name !== "bashir") {
      throw new NotFoundException("No matching Bashir draft found.");
    }

    const alreadyPublished = await prisma.auditLog.findFirst({
      where: { actorAgentId: agent.id, action: "content.published", entityId: draft.entityId },
    });
    if (alreadyPublished) {
      throw new BadRequestException("This draft has already been published.");
    }

    // AuthenticatedBirrStaff carries only id/userId/staffRole/mfaEnabled
    // — no display name — so "who approved it" needs one small lookup
    // before it can actually be attributable in the snapshot below.
    const publishingUser = await prisma.user.findUniqueOrThrow({
      where: { id: staff.userId },
      select: { fullName: true },
    });

    return this.auditLogs.write({
      waqfId: draft.waqfId ?? undefined,
      actorType: "ai_agent",
      actorAgentId: agent.id,
      action: "content.published",
      entityType: draft.entityType,
      entityId: draft.entityId,
      after: {
        ...(draft.after as Record<string, unknown>),
        publishedByStaffId: staff.userId,
        publishedByName: publishingUser.fullName,
        publishedByRole: staff.staffRole,
      },
    });
  }
}
