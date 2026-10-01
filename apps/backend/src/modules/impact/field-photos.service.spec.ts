import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { FieldPhotosService } from "./field-photos.service";

// Runs against the shared dev database. Everything it creates is tagged with a
// per-run stamp in its names, and public-list assertions only look at rows
// carrying that tag, so unrelated data in the database can't affect them.
describe("FieldPhotosService", () => {
  const service = new FieldPhotosService();
  const stamp = `fp${Date.now()}`;
  const ids = { vaults: [] as string[], counterparties: [] as string[], photos: [] as string[], milestones: [] as string[], distributions: [] as string[], causes: [] as string[] };
  let staffUserId: string;
  let otherVaultId: string;
  let vault: { id: string; slug: string; name: string };
  let paidDistribution: { id: string };
  let pendingDistribution: { id: string };
  let completedMilestone: { id: string };
  let pendingMilestone: { id: string };

  beforeAll(async () => {
    // Fixture Users not cleaned up — audit_logs references them and that table is insert-only.
    staffUserId = (await prisma.user.create({ data: { email: `fp-staff-${stamp}@example.com`, fullName: "Field Photo Staff" } })).id;
    const makeVault = async (suffix: string, status: "open" | "draft") => {
      const v = await prisma.vault.create({
        data: { name: `Field Vault ${stamp} ${suffix}`, slug: `field-vault-${stamp}-${suffix}`, type: "project", currency: "NGN", jurisdiction: "NG", status, createdByUserId: staffUserId },
      });
      ids.vaults.push(v.id);
      return v;
    };
    vault = await makeVault("a", "open");
    otherVaultId = (await makeVault("b", "open")).id;
    const cause = await prisma.vaultCause.create({ data: { vaultId: vault.id, name: `Clean Water ${stamp}` } });
    ids.causes.push(cause.id);
    const counterparty = await prisma.counterparty.create({ data: { name: `Delivery Partner ${stamp}`, institutionType: "relief_partner", jurisdiction: "NG" } });
    ids.counterparties.push(counterparty.id);

    const dist = (status: "paid" | "pending") =>
      prisma.vaultDistribution.create({
        data: { vaultId: vault.id, vaultCauseId: cause.id, counterpartyId: counterparty.id, amount: "1000", currency: "NGN", status, paidAt: status === "paid" ? new Date() : null },
      });
    paidDistribution = await dist("paid");
    pendingDistribution = await dist("pending");
    ids.distributions.push(paidDistribution.id, pendingDistribution.id);

    const milestone = (name: string, status: "completed" | "pending", evidenceFileUrl?: string) =>
      prisma.vaultMilestone.create({
        data: { vaultId: vault.id, name, sequence: Math.floor(Math.random() * 1_000_000), status, completedAt: status === "completed" ? new Date() : null, evidenceFileUrl },
      });
    completedMilestone = await milestone(`Borehole drilled ${stamp}`, "completed", "http://localhost:4000/uploads/vault-milestone-evidence/evidence-1.jpg");
    pendingMilestone = await milestone(`Pipes laid ${stamp}`, "pending");
    ids.milestones.push(completedMilestone.id, pendingMilestone.id);
    // A PDF as milestone evidence must NOT appear in a photo wall.
    ids.milestones.push((await milestone(`Report ${stamp}`, "completed", "http://localhost:4000/uploads/vault-milestone-evidence/report.pdf")).id);
  });

  afterAll(async () => {
    await prisma.vaultFieldPhoto.deleteMany({ where: { vaultId: { in: ids.vaults } } });
    await prisma.vaultDistribution.deleteMany({ where: { id: { in: ids.distributions } } });
    await prisma.vaultMilestone.deleteMany({ where: { id: { in: ids.milestones } } });
    await prisma.vaultCause.deleteMany({ where: { id: { in: ids.causes } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: ids.counterparties } } });
    await prisma.vault.deleteMany({ where: { id: { in: ids.vaults } } });
    await prisma.$disconnect();
  });

  const upload = (over: Partial<Parameters<FieldPhotosService["createMany"]>[0]> = {}, urls = ["http://localhost:4000/uploads/field-photos/a.jpg"]) =>
    service.createMany(
      { vaultId: vault.id, eventType: "distribution", eventId: paidDistribution.id, consentConfirmed: "true", ...over },
      urls,
      staffUserId,
    );
  const mine = async () => (await service.listPublic(200)).filter((p) => p.vaultSlug === vault.slug);

  it("creates one audit-logged row per photo, for a real event of the vault", async () => {
    const photos = await upload({ caption: "Handover to the community committee" }, ["http://localhost:4000/uploads/field-photos/1.jpg", "http://localhost:4000/uploads/field-photos/2.jpg"]);
    expect(photos).toHaveLength(2);
    expect(photos[0]).toMatchObject({ vaultDistributionId: paidDistribution.id, vaultMilestoneId: null, consentConfirmed: true, caption: "Handover to the community committee" });
    for (const p of photos) {
      expect(await prisma.auditLog.count({ where: { entityId: p.id, action: "vault_field_photo.uploaded", actorUserId: staffUserId } })).toBe(1);
    }
  });

  it("refuses without the consent attestation, and writes nothing", async () => {
    const before = await prisma.vaultFieldPhoto.count({ where: { vaultId: vault.id } });
    await expect(upload({ consentConfirmed: "false" })).rejects.toThrow(/consented/);
    expect(await prisma.vaultFieldPhoto.count({ where: { vaultId: vault.id } })).toBe(before);
  });

  it("refuses an event that doesn't exist, or that belongs to a different vault", async () => {
    await expect(upload({ eventId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(BadRequestException);
    await expect(upload({ vaultId: otherVaultId })).rejects.toThrow(/doesn't exist on this vault/);
    await expect(upload({ vaultId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(NotFoundException);
  });

  it("the database refuses a photo with no event, with two events, or without consent", async () => {
    const base = { vaultId: vault.id, imageUrl: "x", consentConfirmed: true, uploadedByUserId: staffUserId };
    await expect(prisma.vaultFieldPhoto.create({ data: base })).rejects.toThrow();
    await expect(prisma.vaultFieldPhoto.create({ data: { ...base, vaultDistributionId: paidDistribution.id, vaultMilestoneId: completedMilestone.id } })).rejects.toThrow();
    await expect(prisma.vaultFieldPhoto.create({ data: { ...base, vaultDistributionId: paidDistribution.id, consentConfirmed: false } })).rejects.toThrow();
  });

  it("shows a photo automatically once its delivery is paid or its milestone is completed — and not before", async () => {
    await upload({ eventType: "distribution", eventId: pendingDistribution.id, caption: "pending-delivery" });
    await upload({ eventType: "milestone", eventId: pendingMilestone.id, caption: "pending-milestone" });
    await upload({ eventType: "distribution", eventId: paidDistribution.id, caption: "paid-delivery" });
    await upload({ eventType: "milestone", eventId: completedMilestone.id, caption: "done-milestone" });

    const captions = (await mine()).map((p) => p.caption);
    expect(captions).toEqual(expect.arrayContaining(["paid-delivery", "done-milestone"]));
    expect(captions).not.toContain("pending-delivery");
    expect(captions).not.toContain("pending-milestone");

    // The moment the delivery is paid, its photo appears — no publishing step.
    await prisma.vaultDistribution.update({ where: { id: pendingDistribution.id }, data: { status: "paid", paidAt: new Date() } });
    expect((await mine()).map((p) => p.caption)).toContain("pending-delivery");
    await prisma.vaultDistribution.update({ where: { id: pendingDistribution.id }, data: { status: "pending", paidAt: null } });
  });

  it("labels each photo from the real event (cause delivered to / milestone name), not typed text", async () => {
    const wall = await mine();
    const delivery = wall.find((p) => p.kind === "delivery");
    const milestone = wall.find((p) => p.kind === "milestone" && p.title === `Borehole drilled ${stamp}`);
    expect(delivery).toMatchObject({ title: `Clean Water ${stamp}`, vaultName: vault.name, vaultSlug: vault.slug });
    expect(milestone).toBeDefined();
  });

  it("also shows image evidence already attached to a completed milestone, but never a PDF", async () => {
    const wall = await mine();
    expect(wall.some((p) => p.id.startsWith("evidence-") && p.imageUrl.endsWith("evidence-1.jpg"))).toBe(true);
    expect(wall.some((p) => p.imageUrl.endsWith("report.pdf"))).toBe(false);
  });

  it("hide takes a photo off the public wall at once, unhide restores it; both are audit-logged and need no second person", async () => {
    const [photo] = await upload({ caption: "to-hide" });
    expect((await mine()).map((p) => p.caption)).toContain("to-hide");

    await service.hide(photo.id, staffUserId);
    expect((await mine()).map((p) => p.caption)).not.toContain("to-hide");
    expect(await prisma.auditLog.count({ where: { entityId: photo.id, action: "vault_field_photo.hidden" } })).toBe(1);
    await expect(service.hide(photo.id, staffUserId)).rejects.toThrow(/already hidden/);

    await service.unhide(photo.id, staffUserId);
    expect((await mine()).map((p) => p.caption)).toContain("to-hide");
  });

  it("archive soft-removes (never hard-deletes) and audit-logs", async () => {
    const [photo] = await upload({ caption: "to-archive" });
    await service.archive(photo.id, staffUserId);
    expect((await mine()).map((p) => p.caption)).not.toContain("to-archive");
    expect((await prisma.vaultFieldPhoto.findUnique({ where: { id: photo.id } }))?.deletedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: photo.id, action: "vault_field_photo.archived" } })).toBe(1);
  });

  it("a vault that isn't public (draft) shows nothing, and the staff list explains what a photo is waiting for", async () => {
    await prisma.vault.update({ where: { id: vault.id }, data: { status: "draft" } });
    expect((await mine()).length).toBe(0);
    const staffView = await service.listForVault(vault.id);
    expect(staffView.find((p) => p.caption === "pending-milestone")?.waitingFor).toBe("the milestone to be completed");
    expect(staffView.find((p) => p.caption === "paid-delivery")?.waitingFor).toBe("the vault to be published");
    await prisma.vault.update({ where: { id: vault.id }, data: { status: "open" } });
  });

  it("returns only public fields — no uploader or staff identifiers", async () => {
    const [item] = await mine();
    expect(Object.keys(item).sort()).toEqual(["caption", "id", "imageUrl", "kind", "occurredAt", "title", "vaultName", "vaultSlug"]);
  });
});
