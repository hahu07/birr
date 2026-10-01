import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ImpactPhotosService } from "./impact-photos.service";

describe("ImpactPhotosService", () => {
  const service = new ImpactPhotosService();
  const photoIds: string[] = [];
  let uploaderId: string;
  let reviewerId: string;

  beforeAll(async () => {
    // Fixture Users not cleaned up — audit_logs references them and that table is insert-only.
    uploaderId = (await prisma.user.create({ data: { email: `impact-uploader-${Date.now()}@example.com`, fullName: "Impact Uploader" } })).id;
    reviewerId = (await prisma.user.create({ data: { email: `impact-reviewer-${Date.now()}@example.com`, fullName: "Impact Reviewer" } })).id;
  });

  afterAll(async () => {
    await prisma.impactPhoto.deleteMany({ where: { id: { in: photoIds } } });
    await prisma.$disconnect();
  });

  async function newPhoto(overrides: { altText?: string; credit?: string } = {}) {
    const photo = await service.create(
      { altText: overrides.altText ?? "Children at a borehole in Kano", credit: overrides.credit, consentConfirmed: "true" },
      "http://localhost:4000/uploads/impact-photos/test.jpg",
      uploaderId,
    );
    photoIds.push(photo.id);
    return photo;
  }
  const publish = (id: string, reviewer = reviewerId) => prisma.$transaction((tx) => service.publish(id, tx, reviewer));

  it("create() refuses without the consent attestation, and writes nothing", async () => {
    const before = await prisma.impactPhoto.count();
    await expect(service.create({ altText: "A photo of a school", consentConfirmed: "false" }, "http://x/y.jpg", uploaderId)).rejects.toThrow(/consented/);
    expect(await prisma.impactPhoto.count()).toBe(before);
  });

  it("create() starts as a draft with the attestation recorded, and is audit-logged", async () => {
    const photo = await newPhoto();
    expect(photo).toMatchObject({ status: "draft", consentConfirmed: true, reviewedByUserId: null });
    const logs = await prisma.auditLog.findMany({ where: { entityId: photo.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorUserId: uploaderId, action: "impact_photo.uploaded" });
  });

  it("the database refuses a row without the consent attestation", async () => {
    await expect(
      prisma.impactPhoto.create({ data: { imageUrl: "x", altText: "no consent", consentConfirmed: false, createdByUserId: uploaderId } }),
    ).rejects.toThrow();
  });

  it("update() edits a draft but refuses a published photo", async () => {
    const photo = await newPhoto();
    const edited = await service.update(photo.id, { altText: "A clearer description" }, uploaderId);
    expect(edited.altText).toBe("A clearer description");
    await publish(photo.id);
    await expect(service.update(photo.id, { altText: "sneaky" }, uploaderId)).rejects.toThrow(BadRequestException);
  });

  it("publish() records the reviewer, and refuses the uploader and non-drafts", async () => {
    const photo = await newPhoto();
    await expect(publish(photo.id, uploaderId)).rejects.toThrow(/uploaded a photo/);
    const live = await publish(photo.id);
    expect(live).toMatchObject({ status: "published", reviewedByUserId: reviewerId, reviewedByName: "Impact Reviewer" });
    await expect(publish(photo.id)).rejects.toThrow(BadRequestException);
  });

  it("the database itself refuses a published photo with no reviewer, or reviewed by its own uploader", async () => {
    const photo = await newPhoto();
    await expect(prisma.impactPhoto.update({ where: { id: photo.id }, data: { status: "published", publishedAt: new Date() } })).rejects.toThrow();
    await expect(
      prisma.impactPhoto.update({ where: { id: photo.id }, data: { status: "published", publishedAt: new Date(), reviewedByUserId: uploaderId, reviewedByName: "Self" } }),
    ).rejects.toThrow();
  });

  it("unpublish() returns it to draft and clears the reviewer; archive() soft-removes and audit-logs", async () => {
    const photo = await newPhoto();
    await publish(photo.id);
    const draft = await service.unpublish(photo.id, uploaderId);
    expect(draft).toMatchObject({ status: "draft", reviewedByUserId: null, publishedAt: null });

    await service.archive(photo.id, uploaderId);
    expect(await service.findById(photo.id)).toBeNull();
    expect((await prisma.impactPhoto.findUnique({ where: { id: photo.id } }))?.status).toBe("archived");
    expect(await prisma.auditLog.count({ where: { entityId: photo.id, action: "impact_photo.archived" } })).toBe(1);
    await expect(service.archive(photo.id, uploaderId)).rejects.toThrow(NotFoundException);
  });

  it("the public list shows approved photos only, newest first, with no staff ids", async () => {
    const draft = await newPhoto({ altText: "Still a draft photo" });
    const older = await newPhoto({ altText: "Older approved photo" });
    await publish(older.id);
    const newer = await newPhoto({ altText: "Newer approved photo", credit: "Birr team" });
    await publish(newer.id);

    const list = await service.listPublic(50);
    const alts = list.map((p) => p.altText);
    expect(alts).not.toContain(draft.altText);
    expect(alts.indexOf("Newer approved photo")).toBeLessThan(alts.indexOf("Older approved photo"));
    expect(Object.keys(list[0]).sort()).toEqual(["altText", "credit", "imageUrl"]);
    expect((await service.listPublic(1)).length).toBe(1);
  });
});
