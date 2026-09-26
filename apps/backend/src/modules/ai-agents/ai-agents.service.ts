import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsObject, IsOptional, IsString } from "class-validator";
import { prisma, AiAgent } from "@birr/db";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedBirrStaff } from "../../common/auth/current-birr-staff";
import { InvestmentsService } from "../investments/investments.service";
import { InvestmentTargetsService } from "../investments/investment-targets.service";
import { VaultInvestmentsService } from "../vaults/vault-investments.service";
import { VaultInvestmentTargetsService } from "../vaults/vault-investment-targets.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";

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
  rashid: ["investment_memo.drafted"],
  munsif: ["distribution_recommendation.drafted"],
};

// Per-agent name -> the audit_logs `action` that records a human's real
// disposition on that agent's own draft (used it as-is, or changed it)
// — deliberately not every agent. Only Rafiq has one clear, already-
// built downstream consumption point today (a Founder's onboarding
// purpose field, either submitted unchanged or edited — see
// FoundersService.establishFounderAndFoundation's own
// onboarding_assist.disposition_recorded write site). Extend this map
// only when another agent's own consumption point is similarly
// well-defined; don't invent one just to fill in a row on the Ops
// Console table below.
const DISPOSITION_ACTION: Record<string, string> = {
  rafiq: "onboarding_assist.disposition_recorded",
};

@Injectable()
export class AiAgentsService {
  constructor(
    private readonly auditLogs: AuditLogsService,
    private readonly investmentsService: InvestmentsService,
    private readonly investmentTargetsService: InvestmentTargetsService,
    private readonly vaultInvestmentsService: VaultInvestmentsService,
    private readonly vaultInvestmentTargetsService: VaultInvestmentTargetsService,
    private readonly beneficiariesService: BeneficiariesService,
  ) {}

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
  // none has graduated), when it last did anything at all, and — for
  // the one agent with a real disposition signal wired up (see
  // DISPOSITION_ACTION above) — how often its draft was actually used
  // as offered versus changed. Real signal an officer can look at, not
  // a fabricated readiness score.
  async list() {
    const agents = await prisma.aiAgent.findMany({ where: { status: "active" }, select: SAFE_AGENT_SELECT });
    const agentIds = agents.map((a) => a.id);
    if (agentIds.length === 0) return agents.map((a) => ({ ...a, draftCount: 0, governedActionCount: 0, lastActiveAt: null, dispositions: null }));

    const dispositionActions = Object.values(DISPOSITION_ACTION);
    const [draftStats, governedActionCounts, dispositionRows] = await Promise.all([
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
      // The disposition itself lives inside `after` (a human's action,
      // recorded as JSON, same as every other audit_logs snapshot) —
      // Postgres/Prisma can't groupBy into a JSON field, and the volume
      // here (Founder onboarding events) is small enough that fetching
      // the rows and reducing in JS is the honest tradeoff, not an N+1
      // risk.
      dispositionActions.length > 0
        ? prisma.auditLog.findMany({
            where: { action: { in: dispositionActions } },
            select: { action: true, after: true },
          })
        : Promise.resolve([]),
    ]);
    const draftStatsById = new Map(draftStats.map((d) => [d.actorAgentId, d]));
    const governedActionCountById = new Map(governedActionCounts.map((g) => [g.makerAgentId, g._count._all]));

    const dispositionCountsByAction = new Map<string, { accepted: number; changed: number }>();
    for (const row of dispositionRows) {
      const disposition = (row.after as { disposition?: string } | null)?.disposition;
      const counts = dispositionCountsByAction.get(row.action) ?? { accepted: 0, changed: 0 };
      if (disposition === "accepted") counts.accepted += 1;
      else if (disposition === "changed") counts.changed += 1;
      dispositionCountsByAction.set(row.action, counts);
    }

    return agents.map((agent) => {
      const dispositionAction = DISPOSITION_ACTION[agent.name];
      return {
        ...agent,
        draftCount: draftStatsById.get(agent.id)?._count._all ?? 0,
        governedActionCount: governedActionCountById.get(agent.id) ?? 0,
        lastActiveAt: draftStatsById.get(agent.id)?._max.createdAt ?? null,
        // null (not {accepted: 0, changed: 0}) when this agent has no
        // disposition-tracking consumption point at all — distinguishes
        // "genuinely zero data" (a real agent with the feature that just
        // hasn't been used yet) from "not applicable" (no such feature
        // exists for this agent).
        dispositions: dispositionAction ? (dispositionCountsByAction.get(dispositionAction) ?? { accepted: 0, changed: 0 }) : null,
      };
    });
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

  /**
   * GET /ai-agents/:name/portfolio-data — Rashid's read_portfolio_data
   * tool. Platform-wide, unscoped (same posture as jurisdictionData/
   * caseDigestData above — no per-agent-to-waqf/vault assignment
   * concept exists anywhere in this schema). Scoped to Investment-type
   * Waqfs/Vaults only, since every other type never has investments to
   * begin with (see InvestmentsService.createOne's own restriction).
   * Every fund appears in the snapshot even with no investments/targets
   * yet — computeDrift() already returns an empty, non-drifted report
   * in that case, so nothing is silently omitted.
   */
  async portfolioData() {
    const [waqfs, vaults] = await Promise.all([
      prisma.waqf.findMany({ where: { type: "investment", deletedAt: null }, select: { id: true, name: true } }),
      prisma.vault.findMany({ where: { type: "investment" }, select: { id: true, name: true } }),
    ]);

    const [waqfPortfolios, vaultPortfolios] = await Promise.all([
      Promise.all(
        waqfs.map(async (w) => ({
          waqfId: w.id,
          waqfName: w.name,
          investments: await this.investmentsService.list(w.id),
          drift: await this.investmentTargetsService.computeDrift(w.id),
        })),
      ),
      Promise.all(
        vaults.map(async (v) => ({
          vaultId: v.id,
          vaultName: v.name,
          investments: await this.vaultInvestmentsService.list(v.id),
          drift: await this.vaultInvestmentTargetsService.computeDrift(v.id),
        })),
      ),
    ]);

    return { waqfPortfolios, vaultPortfolios };
  }

  /**
   * GET /ai-agents/:name/beneficiary-verification-data — Munsif's
   * read_beneficiary_records/check_eligibility tools. Unlike
   * jurisdictionData/caseDigestData/portfolioData above, Munsif's own
   * domain (Beneficiary) is genuinely PII-bearing — this deliberately
   * returns only ids and backend-computed flags (see
   * BeneficiariesService.findPossibleDuplicates/listEligibilityIssues'
   * own comments), never a name, phone, email, or bank detail.
   */
  async beneficiaryVerificationData() {
    const [duplicates, eligibilityIssues] = await Promise.all([
      this.beneficiariesService.findPossibleDuplicates(),
      this.beneficiariesService.listEligibilityIssues(),
    ]);
    return { duplicates, eligibilityIssues };
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
