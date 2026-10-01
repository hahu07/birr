import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { prisma, Prisma } from "@birr/db";

export class CreateImpactPhotoInput {
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  altText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  credit?: string;

  // multipart form fields arrive as strings
  @IsString()
  consentConfirmed!: string;
}

export class UpdateImpactPhotoInput {
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  altText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  credit?: string;
}

// Exactly what a public visitor's browser may see — never who uploaded or
// approved it by internal id.
const PUBLIC_SELECT = { imageUrl: true, altText: true, credit: true } satisfies Prisma.ImpactPhotoSelect;

async function findPhotoOrThrow(tx: Prisma.TransactionClient, id: string) {
  const photo = await tx.impactPhoto.findFirst({ where: { id, deletedAt: null } });
  if (!photo) throw new NotFoundException(`Impact photo "${id}" not found.`);
  return photo;
}

@Injectable()
export class ImpactPhotosService {
  /**
   * Plain staff action — starts as a private draft; going live is only
   * possible through the governed `impact_photo.publish` action. The
   * uploader must explicitly attest to consent/rights: this is a picture
   * of real people, shown on a public marketing page.
   */
  async create(input: CreateImpactPhotoInput, imageUrl: string, actorUserId: string) {
    if (input.consentConfirmed !== "true") {
      throw new BadRequestException(
        "Confirm that Birr has the right to publish this photo and that everyone identifiable in it (or their guardian, for a child) has consented.",
      );
    }
    return prisma.$transaction(async (tx) => {
      const photo = await tx.impactPhoto.create({
        data: {
          imageUrl,
          altText: input.altText.trim(),
          credit: input.credit?.trim() || null,
          consentConfirmed: true,
          createdByUserId: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "impact_photo.uploaded",
          entityType: "ImpactPhoto",
          entityId: photo.id,
          after: photo as any,
        },
      });
      return photo;
    });
  }

  /** Drafts only — approved content is frozen; see BlogService.update for the same reasoning. */
  async update(id: string, input: UpdateImpactPhotoInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await findPhotoOrThrow(tx, id);
      if (before.status !== "draft") {
        throw new BadRequestException(`This photo is "${before.status}" — only a draft can be edited. Unpublish it first so changes go back through review.`);
      }
      const photo = await tx.impactPhoto.update({
        where: { id },
        data: { altText: input.altText?.trim(), credit: input.credit === undefined ? undefined : input.credit.trim() || null },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "impact_photo.updated",
          entityType: "ImpactPhoto",
          entityId: id,
          before: before as any,
          after: photo as any,
        },
      });
      return photo;
    });
  }

  /** Internal only — the sole caller is GovernedActionsService's impact_photo.publish handler, on approval. */
  async publish(id: string, tx: Prisma.TransactionClient, reviewerUserId: string) {
    const photo = await findPhotoOrThrow(tx, id);
    if (photo.status !== "draft") {
      throw new BadRequestException(`This photo is "${photo.status}", not "draft" — nothing to publish.`);
    }
    if (photo.createdByUserId === reviewerUserId) {
      throw new BadRequestException("The person who uploaded a photo cannot also be the reviewer who approves it.");
    }
    const reviewer = await tx.user.findUniqueOrThrow({ where: { id: reviewerUserId }, select: { fullName: true } });
    return tx.impactPhoto.update({
      where: { id },
      data: { status: "published", publishedAt: new Date(), reviewedByUserId: reviewerUserId, reviewedByName: reviewer.fullName },
    });
  }

  /** Taking a photo down needs no second person — removing from public view is the safe direction. */
  async unpublish(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await findPhotoOrThrow(tx, id);
      if (before.status !== "published") {
        throw new BadRequestException(`This photo is "${before.status}", not "published".`);
      }
      const photo = await tx.impactPhoto.update({
        where: { id },
        data: { status: "draft", publishedAt: null, reviewedByUserId: null, reviewedByName: null },
      });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "impact_photo.unpublished", entityType: "ImpactPhoto", entityId: id, before: before as any, after: photo as any },
      });
      return photo;
    });
  }

  /** Soft removal — never a hard delete. */
  async archive(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await findPhotoOrThrow(tx, id);
      if (before.status === "archived") throw new BadRequestException("This photo is already archived.");
      const photo = await tx.impactPhoto.update({ where: { id }, data: { status: "archived", deletedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorType: "birr_staff", actorUserId, action: "impact_photo.archived", entityType: "ImpactPhoto", entityId: id, before: before as any, after: photo as any },
      });
      return photo;
    });
  }

  findById(id: string) {
    return prisma.impactPhoto.findFirst({ where: { id, deletedAt: null } });
  }

  listForStaff() {
    return prisma.impactPhoto.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
  }

  /** Public: approved photos only, newest first. */
  listPublic(limit = 4) {
    return prisma.impactPhoto.findMany({
      where: { status: "published", deletedAt: null },
      orderBy: { publishedAt: "desc" },
      take: limit,
      select: PUBLIC_SELECT,
    });
  }
}
