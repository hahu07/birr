import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AiAgentsService } from "./ai-agents.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedBirrStaff } from "../../common/auth/current-birr-staff";
import { InvestmentsService } from "../investments/investments.service";
import { InvestmentTargetsService } from "../investments/investment-targets.service";
import { VaultInvestmentsService } from "../vaults/vault-investments.service";
import { VaultInvestmentTargetsService } from "../vaults/vault-investment-targets.service";

describe("AiAgentsService", () => {
  const investmentsService = new InvestmentsService();
  const investmentTargetsService = new InvestmentTargetsService();
  const vaultInvestmentsService = new VaultInvestmentsService();
  const vaultInvestmentTargetsService = new VaultInvestmentTargetsService();
  const service = new AiAgentsService(
    new AuditLogsService(),
    investmentsService,
    investmentTargetsService,
    vaultInvestmentsService,
    vaultInvestmentTargetsService,
  );

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

  describe("portfolioData()", () => {
    const waqfIds: string[] = [];
    const vaultIds: string[] = [];
    const investmentIds: string[] = [];
    const vaultInvestmentIds: string[] = [];

    let portfolioActorUserId: string;
    let counterpartyId: string;
    let withTargetWaqfId: string;
    let noTargetWaqfId: string;
    let assetWaqfId: string;
    let withTargetVaultId: string;
    let noTargetVaultId: string;
    let projectVaultId: string;

    async function makeInvestmentWaqf(name: string) {
      const foundation = await prisma.foundation.create({ data: { name: `${name} Foundation` } });
      const waqf = await prisma.waqf.create({
        data: { name, type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
      });
      waqfIds.push(waqf.id);
      await prisma.contribution.create({
        data: {
          waqfId: waqf.id,
          amount: "1000",
          currency: "USD",
          provider: "paystack",
          providerReference: `ai-agents-portfolio-spec-${randomUUID()}`,
          status: "confirmed",
        },
      });
      return waqf.id;
    }

    async function makeInvestmentVault(name: string) {
      const vault = await prisma.vault.create({
        data: { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID()}`, type: "investment", currency: "USD", jurisdiction: "NG", createdByUserId: portfolioActorUserId },
      });
      vaultIds.push(vault.id);
      await prisma.vaultContribution.create({
        data: {
          vaultId: vault.id,
          amount: "1000",
          currency: "USD",
          provider: "paystack",
          providerReference: `ai-agents-portfolio-spec-${randomUUID()}`,
          status: "confirmed",
        },
      });
      return vault.id;
    }

    beforeAll(async () => {
      const actorUser = await prisma.user.create({
        data: { email: `ai-agents-portfolio-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
      });
      portfolioActorUserId = actorUser.id;
      await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "investment_committee" } });

      const counterparty = await prisma.counterparty.create({
        data: { name: `AI Agents Portfolio Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", status: "active" },
      });
      counterpartyId = counterparty.id;

      withTargetWaqfId = await makeInvestmentWaqf(`Portfolio Data With Target Waqf ${randomUUID()}`);
      const withTargetInvestment = await investmentsService.create(
        { waqfId: withTargetWaqfId, name: "Fixture Sukuk", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        portfolioActorUserId,
      );
      investmentIds.push(withTargetInvestment.id);
      await investmentTargetsService.upsertTarget(withTargetWaqfId, { instrumentType: "sukuk", targetPercent: "50" }, portfolioActorUserId);

      noTargetWaqfId = await makeInvestmentWaqf(`Portfolio Data No Target Waqf ${randomUUID()}`);
      const noTargetInvestment = await investmentsService.create(
        { waqfId: noTargetWaqfId, name: "Fixture Murabaha", instrumentType: "murabaha", allocatedAmount: "300", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        portfolioActorUserId,
      );
      investmentIds.push(noTargetInvestment.id);

      const assetFoundation = await prisma.foundation.create({ data: { name: `Portfolio Data Asset Fixture Foundation ${randomUUID()}` } });
      const assetWaqf = await prisma.waqf.create({
        data: { name: `Portfolio Data Asset Waqf ${randomUUID()}`, type: "asset", jurisdiction: "AE", foundationId: assetFoundation.id },
      });
      assetWaqfId = assetWaqf.id;
      waqfIds.push(assetWaqfId);

      withTargetVaultId = await makeInvestmentVault(`Portfolio Data With Target Vault ${randomUUID()}`);
      const withTargetVaultInvestment = await vaultInvestmentsService.create(
        { vaultId: withTargetVaultId, name: "Vault Fixture Sukuk", instrumentType: "sukuk", allocatedAmount: "500", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        portfolioActorUserId,
      );
      vaultInvestmentIds.push(withTargetVaultInvestment.id);
      await vaultInvestmentTargetsService.upsertTarget(withTargetVaultId, { instrumentType: "sukuk", targetPercent: "50" }, portfolioActorUserId);

      noTargetVaultId = await makeInvestmentVault(`Portfolio Data No Target Vault ${randomUUID()}`);
      const noTargetVaultInvestment = await vaultInvestmentsService.create(
        { vaultId: noTargetVaultId, name: "Vault Fixture Murabaha", instrumentType: "murabaha", allocatedAmount: "300", counterpartyId, businessDescription: "Fixture business description for Shariah screening purposes." },
        portfolioActorUserId,
      );
      vaultInvestmentIds.push(noTargetVaultInvestment.id);

      const projVault = await prisma.vault.create({
        data: { name: `Portfolio Data Project Vault ${randomUUID()}`, slug: `portfolio-data-project-vault-${randomUUID()}`, type: "project", currency: "USD", jurisdiction: "NG", createdByUserId: portfolioActorUserId },
      });
      projectVaultId = projVault.id;
      vaultIds.push(projectVaultId);
    });

    afterAll(async () => {
      await prisma.investmentTarget.deleteMany({ where: { waqfId: { in: waqfIds } } });
      await prisma.shariahScreening.deleteMany({ where: { investmentId: { in: investmentIds } } });
      await prisma.investment.deleteMany({ where: { id: { in: investmentIds } } });
      await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
      await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });

      await prisma.vaultInvestmentTarget.deleteMany({ where: { vaultId: { in: vaultIds } } });
      await prisma.vaultShariahScreening.deleteMany({ where: { vaultInvestmentId: { in: vaultInvestmentIds } } });
      await prisma.vaultInvestment.deleteMany({ where: { id: { in: vaultInvestmentIds } } });
      await prisma.vaultContribution.deleteMany({ where: { vaultId: { in: vaultIds } } });
      await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });

      await prisma.counterparty.deleteMany({ where: { id: counterpartyId } });
    });

    test("includes an Investment-type waqf's investments (with shariahScreening) and a non-empty drift breakdown", async () => {
      const data = await service.portfolioData();
      const portfolio = data.waqfPortfolios.find((p) => p.waqfId === withTargetWaqfId);
      expect(portfolio).toBeDefined();
      expect(portfolio!.investments).toHaveLength(1);
      expect(portfolio!.investments[0]).toHaveProperty("shariahScreening");
      expect(portfolio!.drift.breakdown.length).toBeGreaterThan(0);
    });

    test("includes a waqf with investments but no targets set, with an empty drift breakdown", async () => {
      const data = await service.portfolioData();
      const portfolio = data.waqfPortfolios.find((p) => p.waqfId === noTargetWaqfId);
      expect(portfolio).toBeDefined();
      expect(portfolio!.investments).toHaveLength(1);
      expect(portfolio!.drift).toMatchObject({ breakdown: [], anyDrifted: false });
    });

    test("excludes a non-Investment-type waqf entirely", async () => {
      const data = await service.portfolioData();
      expect(data.waqfPortfolios.some((p) => p.waqfId === assetWaqfId)).toBe(false);
    });

    test("includes an investment-style vault's investments and a non-empty drift breakdown", async () => {
      const data = await service.portfolioData();
      const portfolio = data.vaultPortfolios.find((p) => p.vaultId === withTargetVaultId);
      expect(portfolio).toBeDefined();
      expect(portfolio!.investments).toHaveLength(1);
      expect(portfolio!.investments[0]).toHaveProperty("vaultShariahScreening");
      expect(portfolio!.drift.breakdown.length).toBeGreaterThan(0);
    });

    test("includes a vault with investments but no targets set, with an empty drift breakdown", async () => {
      const data = await service.portfolioData();
      const portfolio = data.vaultPortfolios.find((p) => p.vaultId === noTargetVaultId);
      expect(portfolio).toBeDefined();
      expect(portfolio!.drift).toMatchObject({ breakdown: [], anyDrifted: false });
    });

    test("excludes a project-style vault entirely", async () => {
      const data = await service.portfolioData();
      expect(data.vaultPortfolios.some((p) => p.vaultId === projectVaultId)).toBe(false);
    });
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
