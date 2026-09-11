import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { VaultsService } from "./vaults.service";
import { VaultProceedsService } from "./vault-proceeds.service";

describe("VaultsService", () => {
  const service = new VaultsService(new VaultProceedsService());

  const vaultIds: string[] = [];
  const vaultCauseIds: string[] = [];
  const causeCategoryIds: string[] = [];
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
    await prisma.vaultCause.deleteMany({ where: { id: { in: vaultCauseIds } } });
    await prisma.vault.deleteMany({ where: { id: { in: vaultIds } } });
    await prisma.causeCategory.deleteMany({ where: { id: { in: causeCategoryIds } } });
    await prisma.$disconnect();
  });

  function uniqueSlug(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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

  test("updateStatus(): draft -> open sets openedAt, and open -> draft is rejected as an invalid transition", async () => {
    const vault = await service.create(
      { name: "Status Test Vault", slug: uniqueSlug("status-test"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    expect(vault.openedAt).toBeNull();

    const opened = await service.updateStatus(vault.id, "open", actorUserId);
    expect(opened.status).toBe("open");
    expect(opened.openedAt).not.toBeNull();

    await expect(service.updateStatus(vault.id, "draft", actorUserId)).rejects.toThrow(BadRequestException);
  });

  test("updateStatus(): archived is only reachable from closed, not directly from open", async () => {
    const vault = await service.create(
      { name: "Archive Path Vault", slug: uniqueSlug("archive-path"), type: "project", currency: "USD", jurisdiction: "NG" },
      actorUserId,
    );
    vaultIds.push(vault.id);
    await service.updateStatus(vault.id, "open", actorUserId);

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
    await service.updateStatus(openVault.id, "open", actorUserId);

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

  test("createCause() throws NotFoundException for an unknown vaultId", async () => {
    await expect(
      service.createCause({ vaultId: "00000000-0000-0000-0000-000000000000", name: "Anything" }, actorUserId),
    ).rejects.toThrow(NotFoundException);
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
});
