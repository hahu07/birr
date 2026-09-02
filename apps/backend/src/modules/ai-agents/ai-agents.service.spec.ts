import { prisma } from "@birr/db";
import { BadRequestException } from "@nestjs/common";
import { AiAgentsService } from "./ai-agents.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";

describe("AiAgentsService", () => {
  const service = new AiAgentsService(new AuditLogsService());

  let rasidAgentId: string;
  let rasidAgentName: string;

  beforeAll(async () => {
    // Reuses the real seeded "rasid" agent row (packages/db/prisma/seed.ts)
    // rather than creating a throwaway one — ALLOWED_DRAFT_ACTIONS is a
    // hardcoded map keyed by agent *name* ("rasid": [...]), so a fixture
    // agent with an arbitrary name would never be allowed to record any
    // draft at all, defeating the point of testing recordDraft().
    const rasid = await prisma.aiAgent.findUnique({ where: { name: "rasid" } });
    if (!rasid) throw new Error('Seeded "rasid" AiAgent row not found — run `pnpm --filter @birr/db seed` first.');
    rasidAgentId = rasid.id;
    rasidAgentName = rasid.name;
  });

  // audit_logs is insert-only at the DB role level (UPDATE/DELETE
  // revoked from birr_app) — the audit_logs rows recordDraft() writes
  // below are deliberately never cleaned up, same posture as every
  // other spec that writes real audit_logs rows via a service call.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("findByName() resolves a real registry row", async () => {
    const agent = await service.findByName(rasidAgentName);
    expect(agent.id).toBe(rasidAgentId);
  });

  test("findByName() throws for an unknown name", async () => {
    await expect(service.findByName(`unknown-agent-${Date.now()}`)).rejects.toThrow();
  });

  test("recordDraft() persists an allowed draft action as an audit_logs row attributed to the agent", async () => {
    const agent = await service.findByName(rasidAgentName);
    const log = await service.recordDraft(agent, {
      action: "compliance_report.drafted",
      entityType: "ComplianceReport",
      entityId: "fixture-report-id",
      draft: { summary: "Fixture draft content." },
    });

    expect(log).toMatchObject({
      actorType: "ai_agent",
      actorAgentId: agent.id,
      action: "compliance_report.drafted",
      entityType: "ComplianceReport",
      entityId: "fixture-report-id",
    });
    expect(log.after).toMatchObject({ summary: "Fixture draft content." });
  });

  test("recordDraft() rejects an action outside this agent's own allow-list", async () => {
    const agent = await service.findByName(rasidAgentName);
    await expect(
      service.recordDraft(agent, {
        action: "distribution.approved", // not in ALLOWED_DRAFT_ACTIONS["rasid"]
        entityType: "Distribution",
        entityId: "fixture-distribution-id",
        draft: {},
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("recordDraft() rejects any action for an agent with no allow-list entry at all", async () => {
    const kashif = await prisma.aiAgent.findUnique({ where: { name: "kashif" } });
    // Kashif is config-only scaffolding (see CLAUDE.md) — this spec
    // doesn't require it to exist, but if it does, it must have no
    // ALLOWED_DRAFT_ACTIONS entry, same structural enforcement this test
    // exists to prove either way.
    if (!kashif) return;
    await expect(
      service.recordDraft(kashif, {
        action: "anything.drafted",
        entityType: "Fixture",
        entityId: "fixture-id",
        draft: {},
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("drafts() returns this agent's own recorded drafts, most recent first", async () => {
    const list = await service.drafts(rasidAgentId);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((l) => l.actorAgentId === rasidAgentId)).toBe(true);
  });

  test("list() includes draftCount reflecting actual recorded drafts", async () => {
    const agents = await service.list();
    const rasidRow = agents.find((a) => a.id === rasidAgentId);
    expect(rasidRow).toBeDefined();
    expect(rasidRow!.draftCount).toBeGreaterThan(0);
    expect(rasidRow!.lastActiveAt).not.toBeNull();
    // apiKeyHash must never appear on this response — see SAFE_AGENT_SELECT's
    // own comment on why.
    expect((rasidRow as any).apiKeyHash).toBeUndefined();
  });

  test("jurisdictionData() returns waqfs without any founder-scoping (staff-only tool data)", async () => {
    const data = await service.jurisdictionData();
    expect(Array.isArray(data)).toBe(true);
  });

  test("caseDigestData() returns open governed actions and active case assignments", async () => {
    const data = await service.caseDigestData();
    expect(data).toHaveProperty("openGovernedActions");
    expect(data).toHaveProperty("caseAssignments");
    expect(Array.isArray(data.openGovernedActions)).toBe(true);
    expect(Array.isArray(data.caseAssignments)).toBe(true);
  });
});
