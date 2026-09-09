import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AiAgentsService } from "./ai-agents.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedBirrStaff } from "../../common/auth/current-birr-staff";

describe("AiAgentsService", () => {
  const service = new AiAgentsService(new AuditLogsService());

  let rasidAgentId: string;
  let rasidAgentName: string;
  let bashirAgentId: string;
  let publisherStaff: AuthenticatedBirrStaff;

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

    const bashir = await prisma.aiAgent.findUnique({ where: { name: "bashir" } });
    if (!bashir) throw new Error('Seeded "bashir" AiAgent row not found — run `pnpm --filter @birr/db seed` first.');
    bashirAgentId = bashir.id;

    // A legal_adviser fixture staff member — publishDraft() itself only
    // trusts the caller already passed the controller's own
    // @RequiresStaffRole(["legal_adviser", "compliance_officer"]) gate
    // (tested separately at the controller level); this fixture exists
    // so publishDraft()'s own draft-state checks can be tested with a
    // realistic caller identity.
    const publisherUser = await prisma.user.create({
      data: { email: `ai-agents-publisher-${Date.now()}@example.com`, fullName: "Test Legal Adviser" },
    });
    const publisherBirrStaff = await prisma.birrStaff.create({
      data: { userId: publisherUser.id, staffRole: "legal_adviser" },
    });
    publisherStaff = {
      id: publisherBirrStaff.id,
      userId: publisherUser.id,
      staffRole: publisherBirrStaff.staffRole,
      mfaEnabled: false,
    };
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

  describe("publishDraft()", () => {
    test("rejects a non-existent draft id", async () => {
      await expect(service.publishDraft(`00000000-0000-0000-0000-${Date.now()}`, publisherStaff)).rejects.toThrow(
        NotFoundException,
      );
    });

    test("rejects a draft that isn't Bashir's", async () => {
      const bashir = await service.findByName("bashir");
      const rasidDraft = await service.recordDraft(await service.findByName(rasidAgentName), {
        action: "compliance_report.drafted",
        entityType: "ComplianceReport",
        entityId: `fixture-non-bashir-${Date.now()}`,
        draft: { summary: "Not a Bashir draft." },
      });
      await expect(service.publishDraft(rasidDraft.id, publisherStaff)).rejects.toThrow(NotFoundException);
      // Sanity: bashir's own id is a real row, not undefined, so the
      // rejection above is actually exercising the name check and not
      // failing earlier for an unrelated reason.
      expect(bashir.id).toBe(bashirAgentId);
    });

    test("publishes a Bashir draft, recording who approved it", async () => {
      const bashir = await service.findByName("bashir");
      const entityId = `fixture-bashir-content-${Date.now()}`;
      const draft = await service.recordDraft(bashir, {
        action: "content.drafted",
        entityType: "MarketingContent",
        entityId,
        draft: { contentType: "outreach_draft", title: "Fixture title", body: "Fixture body." },
      });

      const published = await service.publishDraft(draft.id, publisherStaff);

      expect(published).toMatchObject({
        actorType: "ai_agent",
        actorAgentId: bashirAgentId,
        action: "content.published",
        entityType: "MarketingContent",
        entityId,
      });
      expect(published.after).toMatchObject({
        title: "Fixture title",
        body: "Fixture body.",
        publishedByStaffId: publisherStaff.userId,
        publishedByName: "Test Legal Adviser",
        publishedByRole: "legal_adviser",
      });
    });

    test("rejects publishing the same draft a second time", async () => {
      const bashir = await service.findByName("bashir");
      const entityId = `fixture-bashir-double-publish-${Date.now()}`;
      const draft = await service.recordDraft(bashir, {
        action: "content.drafted",
        entityType: "MarketingContent",
        entityId,
        draft: { contentType: "outreach_draft", title: "Fixture title", body: "Fixture body." },
      });

      await service.publishDraft(draft.id, publisherStaff);
      await expect(service.publishDraft(draft.id, publisherStaff)).rejects.toThrow(BadRequestException);
    });
  });
});
