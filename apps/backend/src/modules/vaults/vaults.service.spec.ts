import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";
import { VaultLedgerService } from "./vault-ledger.service";

describe("VaultsService", () => {
  const ledger = new VaultLedgerService();
  const service = new VaultsService(new VaultProceedsService(), ledger);

  const vaultIds: string[] = [];
  const vaultCauseIds: string[] = [];
  const causeCategoryIds: string[] = [];
  const milestoneIds: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff not cleaned up in afterAll — same reasoning
    // as every other spec in this codebase (audit_logs references, and
    // that table is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `vaults-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "mutawalli_officer" } });
  });

  afterAll(async () => {
    // Deleted before the vaults themselves — VaultContribution.vaultId
    // has no onDelete: Cascade, so a vault with contributions still on
    // file would otherwise fail the deleteMany below with a foreign
    // key violation.
    await prisma.vaultContribution.deleteMany({ where: { vaultId: { in: vaultIds } } });
    // Journal entry lines before their entries before the vault itself —
    // the "spentSoFar" test (2026-09-14) posts real ledger entries
    // against a fixture vault, with no onDelete: Cascade on that FK.
    await prisma.vaultJournalEntryLine.deleteMany({ where: { journalEntry: { vaultId: { in: vaultIds } } } });
    await prisma.vaultJournalEntry.deleteMany({ where: { vaultId: { in: vaultIds } } });
    await prisma.vaultMilestone.deleteMany({ where: { id: { in: milestoneIds } } });
    await prisma.vaultCause.deleteMany({ where: { id: { in: vaultCauseIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.causeCategory.deleteMany({ where: { id: { in: causeCategoryIds } } });
    await prisma.$disconnect();
  });

  function uniqueSlug(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  // publish() is internal-only — the real caller is
  // GovernedActionsService's vault.publish handler, on approval, inside
  // its own transaction (see that method's own comment). Fixture helper
  // for every other test here that just needs an already-open vault.
  function publishVault(vaultId: string) {
    return prisma.$transaction((tx) => service.publish(vaultId, tx));
  }

  test("create() writes the vault and an audit_logs record attributed to the calling birr_staff", async () => {
    const slug = uniqueSlug("ramadan-relief");
    const vault = await service.create(
      { name: "Ramadan Relief", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);

    expect(vault.status).toBe("draft");
    expect(vault.slug).toBe(slug);

    const logs = await prisma.auditLog.findMany({ where: { entityId: vault.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, action: "vault.created" });
  });

  test("create() rejects a slug that's already in use with a clear error, not a raw 500", async () => {
    const slug = uniqueSlug("duplicate-slug");
    const first = await service.create(
      { name: "First Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(first.id);

    await expect(
      service.create({ name: "Second Vault", slug, type: "investment", currency: "USD", jurisdiction: "NG" }, actorUserId),
    ).rejects.toThrow(ConflictException);
  });

  test("updateStatus(): draft -> open is rejected — publishing is the governed vault.publish action, not a direct staff call", async () => {
    const vault = await service.create(
      { name: "Status Test Vault", slug: uniqueSlug("status-test"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);

    await expect(service.updateStatus(vault.id, "open", actorUserId)).rejects.toThrow(BadRequestException);
    await expect(service.updateStatus(vault.id, "draft", actorUserId)).rejects.toThrow(BadRequestException);
  });

  test("publish(): draft -> open sets openedAt, and rejects a vault that isn't draft", async () => {
    const vault = await service.create(
      { name: "Publish Test Vault", slug: uniqueSlug("publish-test"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    expect(vault.openedAt).toBeNull();

    const opened = await publishVault(vault.id);
    expect(opened.status).toBe("open");
    expect(opened.openedAt).not.toBeNull();

    await expect(publishVault(vault.id)).rejects.toThrow(BadRequestException);
  });

  test("updateStatus(): archived is only reachable from closed, not directly from open", async () => {
    const vault = await service.create(
      { name: "Archive Path Vault", slug: uniqueSlug("archive-path"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);

    await expect(service.updateStatus(vault.id, "archived", actorUserId)).rejects.toThrow(BadRequestException);

    const closed = await service.updateStatus(vault.id, "closed", actorUserId);
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).not.toBeNull();

    const archived = await service.updateStatus(vault.id, "archived", actorUserId);
    expect(archived.status).toBe("archived");
  });

  test("updateStatus() throws NotFoundException for an unknown vault id", async () => {
    await expect(service.updateStatus("00000000-0000-0000-0000-000000000000", "open", actorUserId)).rejects.toThrow(
      NotFoundException,
    );
  });

  test("listOpen() returns only status: open vaults, not draft/closed/archived ones", async () => {
    const draftVault = await service.create(
      { name: "Still Draft Vault", slug: uniqueSlug("still-draft"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(draftVault.id);
    const openVault = await service.create(
      { name: "Open For Business Vault", slug: uniqueSlug("open-for-business"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(openVault.id);
    await publishVault(openVault.id);

    const openList = await service.listOpen();
    const openIds = openList.map((v) => v.id);
    expect(openIds).toContain(openVault.id);
    expect(openIds).not.toContain(draftVault.id);
  });

  test("createCause(): a custom cause (no causeCategoryId) uses the supplied name, and a duplicate name on the same vault is rejected", async () => {
    const vault = await service.create(
      { name: "Causes Test Vault", slug: uniqueSlug("causes-test"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);

    const cause = await service.createCause({ vaultId: vault.id, name: "Orphan Care" }, actorUserId);
    vaultCauseIds.push(cause.id);
    expect(cause.name).toBe("Orphan Care");
    expect(cause.causeCategoryId).toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: cause.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, action: "vault_cause.created" });

    await expect(service.createCause({ vaultId: vault.id, name: "Orphan Care" }, actorUserId)).rejects.toThrow(
      ConflictException,
    );
  });

  test("createCause(): picking from the shared CauseCategory catalog copies name/description at selection time", async () => {
    const category = await prisma.causeCategory.create({
      data: { name: `Vault Fixture Category ${Date.now()}`, description: "Category description at creation time." },
    });
    causeCategoryIds.push(category.id);

    const vault = await service.create(
      { name: "Catalog Cause Vault", slug: uniqueSlug("catalog-cause"), type: "investment", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);

    const cause = await service.createCause({ vaultId: vault.id, causeCategoryId: category.id }, actorUserId);
    vaultCauseIds.push(cause.id);
    expect(cause.name).toBe(category.name);
    expect(cause.description).toBe(category.description);
    expect(cause.causeCategoryId).toBe(category.id);
  });

  test("createCause(): picking from the catalog copies the category's projectPlan as a default, but an explicit projectPlan on the cause wins", async () => {
    const category = await prisma.causeCategory.create({
      data: {
        name: `Vault Fixture Category With Plan ${Date.now()}`,
        description: "Category description.",
        projectPlan: "Generic category-level default plan.",
      },
    });
    causeCategoryIds.push(category.id);

    const vault = await service.create(
      { name: "Catalog Default Plan Vault", slug: uniqueSlug("catalog-default-plan"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);

    const withDefault = await service.createCause({ vaultId: vault.id, causeCategoryId: category.id }, actorUserId);
    vaultCauseIds.push(withDefault.id);
    expect(withDefault.projectPlan).toBe("Generic category-level default plan.");

    const secondVault = await service.create(
      { name: "Catalog Override Plan Vault", slug: uniqueSlug("catalog-override-plan"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(secondVault.id);
    const withOverride = await service.createCause(
      { vaultId: secondVault.id, causeCategoryId: category.id, projectPlan: "This specific vault's own plan." },
      actorUserId,
    );
    vaultCauseIds.push(withOverride.id);
    expect(withOverride.projectPlan).toBe("This specific vault's own plan.");
  });

  test("createCause() throws NotFoundException for an unknown vaultId", async () => {
    await expect(
      service.createCause({ vaultId: "00000000-0000-0000-0000-000000000000", name: "Anything" }, actorUserId),
    ).rejects.toThrow(NotFoundException);
  });

  test("createCause() accepts an optional projectPlan, null when omitted", async () => {
    const vault = await service.create(
      { name: "Project Plan At Creation Vault", slug: uniqueSlug("project-plan-create"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);

    const withPlan = await service.createCause(
      { vaultId: vault.id, name: "Clean Water", projectPlan: "Drilled by Partner X, one well per 500 people." },
      actorUserId,
    );
    vaultCauseIds.push(withPlan.id);
    expect(withPlan.projectPlan).toBe("Drilled by Partner X, one well per 500 people.");

    const withoutPlan = await service.createCause({ vaultId: vault.id, name: "Food Relief" }, actorUserId);
    vaultCauseIds.push(withoutPlan.id);
    expect(withoutPlan.projectPlan).toBeNull();
  });

  describe("updateCauseProjectPlan()", () => {
    test("sets projectPlan, audit-logged with a real before/after, and leaves it alone when called with undefined", async () => {
      const vault = await service.create(
        { name: "Update Project Plan Vault", slug: uniqueSlug("update-project-plan"), type: "project", currency: "USD", jurisdiction: "NG" },
        actorUserId,
      );
      vaultIds.push(vault.id);
      const cause = await service.createCause({ vaultId: vault.id, name: "Education Stipends" }, actorUserId);
      vaultCauseIds.push(cause.id);
      expect(cause.projectPlan).toBeNull();

      const withPlan = await service.updateCauseProjectPlan(
        cause.id,
        { projectPlan: "Monthly stipends paid directly to enrolled students via Partner Y." },
        actorUserId,
      );
      expect(withPlan.projectPlan).toBe("Monthly stipends paid directly to enrolled students via Partner Y.");

      // Calling again with undefined leaves the previously-set value alone
      // — same "only overwrite whichever field is sent" contract as
      // setFeasibilityReport.
      const unchanged = await service.updateCauseProjectPlan(cause.id, {}, actorUserId);
      expect(unchanged.projectPlan).toBe("Monthly stipends paid directly to enrolled students via Partner Y.");

      const logs = await prisma.auditLog.findMany({
        where: { entityId: cause.id, action: "vault_cause.project_plan_updated" },
        orderBy: { createdAt: "asc" },
      });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, vaultId: vault.id });
      expect(logs[0].before).toMatchObject({ projectPlan: null });
      expect(logs[0].after).toMatchObject({ projectPlan: "Monthly stipends paid directly to enrolled students via Partner Y." });
    });

    test("throws NotFoundException for an unknown cause id", async () => {
      await expect(
        service.updateCauseProjectPlan("00000000-0000-0000-0000-000000000000", { projectPlan: "x" }, actorUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateCauseTargetAmount()", () => {
    test("sets targetAmount, audit-logged with a real before/after, and null clears it back to no goal", async () => {
      const vault = await service.create(
        { name: "Update Target Amount Vault", slug: uniqueSlug("update-target-amount"), type: "project", currency: "NGN", jurisdiction: "NG" },
        actorUserId,
      );
      vaultIds.push(vault.id);
      const cause = await service.createCause({ vaultId: vault.id, name: "Water Wells" }, actorUserId);
      vaultCauseIds.push(cause.id);
      expect(cause.targetAmount).toBeNull();

      const withGoal = await service.updateCauseTargetAmount(cause.id, { targetAmount: "2000000" }, actorUserId);
      expect(withGoal.targetAmount?.toString()).toBe("2000000");

      const cleared = await service.updateCauseTargetAmount(cause.id, { targetAmount: null }, actorUserId);
      expect(cleared.targetAmount).toBeNull();

      const logs = await prisma.auditLog.findMany({
        where: { entityId: cause.id, action: "vault_cause.target_amount_updated" },
        orderBy: { createdAt: "asc" },
      });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, vaultId: vault.id });
      expect(logs[0].before).toMatchObject({ targetAmount: null });
      expect(logs[0].after).toMatchObject({ targetAmount: "2000000" });
      expect(logs[1].before).toMatchObject({ targetAmount: "2000000" });
      expect(logs[1].after).toMatchObject({ targetAmount: null });
    });

    test("throws NotFoundException for an unknown cause id", async () => {
      await expect(
        service.updateCauseTargetAmount("00000000-0000-0000-0000-000000000000", { targetAmount: "100" }, actorUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  test("listCauses() flattens each cause's catalog icon the same way the public routes do, alongside its allocations and targetAmount", async () => {
    const category = await prisma.causeCategory.create({
      data: { name: `Ops List Icon Category ${Date.now()}`, icon: "🚨" },
    });
    causeCategoryIds.push(category.id);

    const vault = await service.create(
      { name: "Ops List Causes Vault", slug: uniqueSlug("ops-list-causes"), type: "project", currency: "NGN", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    const fromCatalog = await service.createCause({ vaultId: vault.id, causeCategoryId: category.id }, actorUserId);
    const custom = await service.createCause({ vaultId: vault.id, name: "Ops Custom Cause" }, actorUserId);
    vaultCauseIds.push(fromCatalog.id, custom.id);
    await service.updateCauseTargetAmount(fromCatalog.id, { targetAmount: "500000" }, actorUserId);

    const listed = await service.listCauses(vault.id);
    const catalogRow = listed.find((c) => c.id === fromCatalog.id);
    expect(catalogRow?.icon).toBe("🚨");
    expect(catalogRow).not.toHaveProperty("causeCategory");
    expect(catalogRow?.targetAmount?.toString()).toBe("500000");
    expect(catalogRow?.allocations).toEqual([]);
    expect(listed.find((c) => c.id === custom.id)?.icon).toBeNull();
  });

  test("findBySlug() exposes a cause's own targetAmount publicly, null when no goal has been set", async () => {
    const slug = uniqueSlug("cause-goal-public");
    const vault = await service.create(
      { name: "Cause Goal Public Vault", slug, type: "project", currency: "NGN", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);
    const withGoal = await service.createCause({ vaultId: vault.id, name: "Clean Water Wells" }, actorUserId);
    const withoutGoal = await service.createCause({ vaultId: vault.id, name: "No Goal Yet" }, actorUserId);
    vaultCauseIds.push(withGoal.id, withoutGoal.id);
    await service.updateCauseTargetAmount(withGoal.id, { targetAmount: "2000000" }, actorUserId);

    const bySlug = await service.findBySlug(slug);
    expect(bySlug?.causes.find((c) => c.id === withGoal.id)?.targetAmount?.toString()).toBe("2000000");
    expect(bySlug?.causes.find((c) => c.id === withoutGoal.id)?.targetAmount).toBeNull();
  });

  test("findBySlug() exposes a cause's projectPlan publicly, alongside its description", async () => {
    const slug = uniqueSlug("project-plan-public");
    const vault = await service.create(
      { name: "Public Project Plan Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);
    const cause = await service.createCause(
      { vaultId: vault.id, name: "Clean Water", description: "Water access in rural Kaduna.", projectPlan: "One well per 500 people, via Partner X." },
      actorUserId,
    );
    vaultCauseIds.push(cause.id);

    const bySlug = await service.findBySlug(slug);
    const publicCause = bySlug?.causes.find((c) => c.id === cause.id);
    expect(publicCause?.description).toBe("Water access in rural Kaduna.");
    expect(publicCause?.projectPlan).toBe("One well per 500 people, via Partner X.");
  });

  test("findById()/findBySlug() return the vault with its causes, and null-equivalent NotFound-worthy results for unknown ids", async () => {
    const slug = uniqueSlug("find-me");
    const vault = await service.create(
      { name: "Find Me Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    const cause = await service.createCause({ vaultId: vault.id, name: "Findable Cause" }, actorUserId);
    vaultCauseIds.push(cause.id);

    const byId = await service.findById(vault.id);
    expect(byId?.causes.map((c) => c.id)).toContain(cause.id);

    const bySlug = await service.findBySlug(slug);
    expect(bySlug?.id).toBe(vault.id);

    expect(await service.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await service.findBySlug("no-such-slug-at-all")).toBeNull();
  });

  test("listOpen()/findBySlug() report amountRaised as the sum of confirmed contributions only, per currency", async () => {
    const slug = uniqueSlug("raised-so-far");
    const vault = await service.create(
      { name: "Raised So Far Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);

    // Two confirmed (should sum), one pending (should not count) — same
    // "pending never counts as raised" posture as everywhere else
    // committed/confirmed money is aggregated in this codebase.
    await prisma.vaultContribution.createMany({
      data: [
        { vaultId: vault.id, amount: "100", currency: "USD", provider: "stripe", providerReference: `${vault.id}-1`, status: "confirmed" },
        { vaultId: vault.id, amount: "50", currency: "USD", provider: "stripe", providerReference: `${vault.id}-2`, status: "confirmed" },
        { vaultId: vault.id, amount: "999", currency: "USD", provider: "stripe", providerReference: `${vault.id}-3`, status: "pending" },
      ],
    });

    const bySlug = await service.findBySlug(slug);
    expect(bySlug?.amountRaised).toEqual([{ currency: "USD", amount: "150" }]);

    const openList = await service.listOpen();
    expect(openList.find((v) => v.id === vault.id)?.amountRaised).toEqual([{ currency: "USD", amount: "150" }]);
  });

  test("listOpen()/findBySlug() report amountRaised as an empty array for a vault with no contributions", async () => {
    const slug = uniqueSlug("nothing-raised-yet");
    const vault = await service.create(
      { name: "Nothing Raised Yet Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);

    expect((await service.findBySlug(slug))?.amountRaised).toEqual([]);
    expect((await service.listOpen()).find((v) => v.id === vault.id)?.amountRaised).toEqual([]);
  });

  test("findBySlug() reports spentSoFar from the Program Expenses ledger account, empty for a vault with nothing spent yet", async () => {
    const slug = uniqueSlug("spent-so-far");
    const vault = await service.create(
      { name: "Spent So Far Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);

    expect((await service.findBySlug(slug))?.spentSoFar).toEqual([]);

    const cashAndBank = await prisma.vaultLedgerAccount.findFirstOrThrow({ where: { code: "1000" } });
    const programExpenses = await prisma.vaultLedgerAccount.findFirstOrThrow({ where: { code: "5000" } });
    await prisma.$transaction((tx) =>
      ledger.post(tx, {
        vaultId: vault.id,
        description: "Expense",
        currency: "USD",
        source: "expense",
        actorType: "system",
        lines: [
          { ledgerAccountId: programExpenses.id, debit: "400" },
          { ledgerAccountId: cashAndBank.id, credit: "400" },
        ],
      }),
    );

    expect((await service.findBySlug(slug))?.spentSoFar).toEqual([{ currency: "USD", amount: "400" }]);
  });

  test("create() accepts additionalCurrencies, deduped against the primary currency and against itself", async () => {
    const slug = uniqueSlug("multi-currency");
    const vault = await service.create(
      { name: "Multi Currency Vault", slug, type: "project", currency: "USD", jurisdiction: "NG", additionalCurrencies: ["NGN", "USDC", "USD", "NGN"] },
      actorUserId,
    );
    vaultIds.push(vault.id);
    expect(vault.additionalCurrencies.sort()).toEqual(["NGN", "USDC"]);
  });

  test("amountRaised reports each accepted currency's own confirmed total separately, never summed together", async () => {
    const slug = uniqueSlug("multi-currency-raised");
    const vault = await service.create(
      { name: "Multi Currency Raised Vault", slug, type: "project", currency: "USD", jurisdiction: "NG", additionalCurrencies: ["NGN"] },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);

    await prisma.vaultContribution.createMany({
      data: [
        { vaultId: vault.id, amount: "100", currency: "USD", provider: "stripe", providerReference: `${vault.id}-usd`, status: "confirmed" },
        { vaultId: vault.id, amount: "50000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-ngn`, status: "confirmed" },
      ],
    });

    const bySlug = await service.findBySlug(slug);
    expect(bySlug?.amountRaised).toEqual(
      expect.arrayContaining([
        { currency: "USD", amount: "100" },
        { currency: "NGN", amount: "50000" },
      ]),
    );
    expect(bySlug?.amountRaised).toHaveLength(2);
  });

  test("findBySlug() reports each cause's own amountRaised, leaving an unearmarked gift out of every cause's total", async () => {
    const slug = uniqueSlug("per-cause-raised");
    const vault = await service.create(
      { name: "Per Cause Raised Vault", slug, type: "project", currency: "NGN", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);
    const water = await service.createCause({ vaultId: vault.id, name: "Clean Water Wells" }, actorUserId);
    const food = await service.createCause({ vaultId: vault.id, name: "Food Parcels" }, actorUserId);
    vaultCauseIds.push(water.id, food.id);

    await prisma.vaultContribution.createMany({
      data: [
        { vaultId: vault.id, vaultCauseId: water.id, amount: "500000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-w1`, status: "confirmed" },
        { vaultId: vault.id, vaultCauseId: water.id, amount: "320000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-w2`, status: "confirmed" },
        { vaultId: vault.id, vaultCauseId: food.id, amount: "1240000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-f1`, status: "confirmed" },
        // "Wherever it's needed most" — counts toward the vault, toward no cause.
        { vaultId: vault.id, amount: "60000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-any`, status: "confirmed" },
      ],
    });

    const bySlug = await service.findBySlug(slug);
    expect(bySlug?.causes.find((c) => c.id === water.id)?.amountRaised).toEqual([{ currency: "NGN", amount: "820000" }]);
    expect(bySlug?.causes.find((c) => c.id === food.id)?.amountRaised).toEqual([{ currency: "NGN", amount: "1240000" }]);
    // The unearmarked 60,000 is in the vault total but in neither cause's.
    expect(bySlug?.amountRaised).toEqual([{ currency: "NGN", amount: "2120000" }]);
  });

  test("a cause's amountRaised excludes held and refunded gifts, and reports each currency separately", async () => {
    const slug = uniqueSlug("per-cause-raised-filtered");
    const vault = await service.create(
      { name: "Per Cause Filtered Vault", slug, type: "project", currency: "NGN", jurisdiction: "NG", additionalCurrencies: ["USDC"] },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);
    const cause = await service.createCause({ vaultId: vault.id, name: "Filtered Cause" }, actorUserId);
    const emptyCause = await service.createCause({ vaultId: vault.id, name: "Nothing Given Yet" }, actorUserId);
    vaultCauseIds.push(cause.id, emptyCause.id);

    await prisma.vaultContribution.createMany({
      data: [
        { vaultId: vault.id, vaultCauseId: cause.id, amount: "100000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-ok`, status: "confirmed" },
        { vaultId: vault.id, vaultCauseId: cause.id, amount: "40", currency: "USDC", provider: "stablecoin", providerReference: `${vault.id}-usdc`, status: "confirmed" },
        { vaultId: vault.id, vaultCauseId: cause.id, amount: "999000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-pending`, status: "pending" },
        { vaultId: vault.id, vaultCauseId: cause.id, amount: "888000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-held`, status: "confirmed", heldAt: new Date() },
        { vaultId: vault.id, vaultCauseId: cause.id, amount: "777000", currency: "NGN", provider: "paystack", providerReference: `${vault.id}-refunded`, status: "confirmed", refundStatus: "refunded" },
      ],
    });

    const bySlug = await service.findBySlug(slug);
    const raised = bySlug?.causes.find((c) => c.id === cause.id)?.amountRaised ?? [];
    expect(raised).toEqual(
      expect.arrayContaining([
        { currency: "NGN", amount: "100000" },
        { currency: "USDC", amount: "40" },
      ]),
    );
    expect(raised).toHaveLength(2);
    // Empty array, never missing, for a cause nobody's given to yet.
    expect(bySlug?.causes.find((c) => c.id === emptyCause.id)?.amountRaised).toEqual([]);
  });

  test("findBySlug() exposes a cause's catalog icon but no other category field, and null for a custom cause", async () => {
    const category = await prisma.causeCategory.create({
      data: {
        name: `Vault Icon Category ${Date.now()}`,
        icon: "💧",
        // Staff reference material, never copied onto a cause by
        // createCause the way name/description/projectPlan are — so it's
        // the honest canary for "did the joined category row leak".
        projectPlanFileUrl: "https://example.invalid/staff-only-checklist.pdf",
      },
    });
    causeCategoryIds.push(category.id);

    const slug = uniqueSlug("cause-icons");
    const vault = await service.create(
      { name: "Cause Icons Vault", slug, type: "project", currency: "NGN", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);
    const fromCatalog = await service.createCause({ vaultId: vault.id, causeCategoryId: category.id }, actorUserId);
    const custom = await service.createCause({ vaultId: vault.id, name: "One-off Custom Cause" }, actorUserId);
    vaultCauseIds.push(fromCatalog.id, custom.id);

    const bySlug = await service.findBySlug(slug);
    const catalogCause = bySlug?.causes.find((c) => c.id === fromCatalog.id);
    expect(catalogCause?.icon).toBe("💧");
    // The nested relation is flattened away, so the category's own
    // staff-only fields can't ride along into the public payload.
    expect(catalogCause).not.toHaveProperty("causeCategory");
    expect(JSON.stringify(bySlug)).not.toContain("staff-only-checklist.pdf");
    expect(bySlug?.causes.find((c) => c.id === custom.id)?.icon).toBeNull();

    // Same flattened shape from the public list route, not just by-slug.
    const fromList = (await service.listOpen()).find((v) => v.id === vault.id);
    expect(fromList?.causes.find((c) => c.id === fromCatalog.id)?.icon).toBe("💧");
  });

  describe("setFeasibilityReport()", () => {
    test("sets title and url, audit-logged with a real before/after, and only overwrites whichever field is sent", async () => {
      const slug = uniqueSlug("feasibility-report");
      const vault = await service.create(
        { name: "Feasibility Report Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
        actorUserId,
      );
      vaultIds.push(vault.id);

      const withTitle = await service.setFeasibilityReport(vault.id, { title: "Kaduna Water Needs Assessment, 2026" }, actorUserId);
      expect(withTitle.feasibilityReportTitle).toBe("Kaduna Water Needs Assessment, 2026");
      expect(withTitle.feasibilityReportUrl).toBeNull();

      const withUrl = await service.setFeasibilityReport(
        vault.id,
        { url: "http://localhost:4000/uploads/vault-documents/x.pdf" },
        actorUserId,
      );
      // Providing only url leaves the previously-set title alone.
      expect(withUrl.feasibilityReportTitle).toBe("Kaduna Water Needs Assessment, 2026");
      expect(withUrl.feasibilityReportUrl).toBe("http://localhost:4000/uploads/vault-documents/x.pdf");

      const logs = await prisma.auditLog.findMany({
        where: { entityId: vault.id, action: "vault.feasibility_report_updated" },
        orderBy: { createdAt: "asc" },
      });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId, vaultId: vault.id });
    });

    test("throws NotFoundException for an unknown vault id", async () => {
      await expect(
        service.setFeasibilityReport("00000000-0000-0000-0000-000000000000", { title: "x" }, actorUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  test("findBySlug() exposes the feasibility report publicly", async () => {
    const slug = uniqueSlug("feasibility-report-public");
    const vault = await service.create(
      { name: "Public Feasibility Report Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);
    await service.setFeasibilityReport(
      vault.id,
      { title: "Site Survey", url: "http://localhost:4000/uploads/vault-documents/site-survey.pdf" },
      actorUserId,
    );

    const bySlug = await service.findBySlug(slug);
    expect(bySlug?.feasibilityReportTitle).toBe("Site Survey");
    expect(bySlug?.feasibilityReportUrl).toBe("http://localhost:4000/uploads/vault-documents/site-survey.pdf");
  });

  test("findBySlug() exposes milestone evidence publicly (owner's explicit direction, 2026-09-14 — donors should see proof of completed work)", async () => {
    const slug = uniqueSlug("milestone-evidence-public");
    const vault = await service.create(
      { name: "Public Milestone Evidence Vault", slug, type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await publishVault(vault.id);
    const milestone = await prisma.vaultMilestone.create({
      data: {
        vaultId: vault.id,
        name: "Borehole drilled",
        sequence: 1,
        status: "completed",
        completedAt: new Date(),
        evidenceNotes: "Borehole completed and tested for potability on site.",
        evidenceFileUrl: "http://localhost:4000/uploads/vault-documents/borehole-photo.jpg",
      },
    });
    milestoneIds.push(milestone.id);

    const bySlug = await service.findBySlug(slug);
    expect(bySlug?.milestones).toHaveLength(1);
    expect(bySlug?.milestones?.[0]?.evidenceNotes).toBe("Borehole completed and tested for potability on site.");
    expect(bySlug?.milestones?.[0]?.evidenceFileUrl).toBe(
      "http://localhost:4000/uploads/vault-documents/borehole-photo.jpg",
    );
    // targetAmount stays excluded — a budget figure, not proof of anything.
    expect((bySlug?.milestones?.[0] as { targetAmount?: unknown })?.targetAmount).toBeUndefined();
  });
});
