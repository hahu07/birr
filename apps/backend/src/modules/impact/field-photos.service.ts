import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { prisma, Prisma } from "@birr/db";

export class UploadFieldPhotosInput {
  @IsString()
  vaultId!: string;

  @IsIn(["distribution", "milestone"])
  eventType!: "distribution" | "milestone";

  @IsString()
  eventId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;

  // multipart form fields arrive as strings
  @IsString()
  consentConfirmed!: string;
}

export interface PublicFieldPhoto {
  id: string;
  imageUrl: string;
  /** "delivery" = a paid distribution; "milestone" = a completed project step. */
  kind: "delivery" | "milestone";
  /** The cause delivered to, or the milestone's name — derived from the event, never typed. */
  title: string;
  caption: string | null;
  vaultName: string;
  vaultSlug: string;
  occurredAt: string;
}

const PUBLIC_VAULT_STATUSES = ["open", "closed"] as const;
const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;

// Only photos whose event is real and whose vault is public are ever shown.
// Computed on every read — not stored — so it can't drift from the event:
// a delivery counts once its distribution is `paid` (itself two-person
// approved), a project step once the milestone is `completed` (also governed).
const VISIBLE_PHOTO_WHERE = {
  hiddenAt: null,
  deletedAt: null,
  vault: { status: { in: [...PUBLIC_VAULT_STATUSES] }, deletedAt: null },
  OR: [
    { vaultDistribution: { status: "paid", deletedAt: null } },
    { vaultMilestone: { status: "completed", deletedAt: null } },
  ],
} satisfies Prisma.VaultFieldPhotoWhereInput;

const PHOTO_INCLUDE = {
  vault: { select: { name: true, slug: true, status: true } },
  vaultDistribution: { select: { status: true, paidAt: true, vaultCause: { select: { name: true } } } },
  vaultMilestone: { select: { name: true, status: true, completedAt: true } },
} satisfies Prisma.VaultFieldPhotoInclude;

type PhotoWithEvent = Prisma.VaultFieldPhotoGetPayload<{ include: typeof PHOTO_INCLUDE }>;

function eventOf(photo: PhotoWithEvent) {
  if (photo.vaultDistribution) {
    return {
      kind: "delivery" as const,
      title: photo.vaultDistribution.vaultCause.name,
      occurredAt: photo.vaultDistribution.paidAt ?? photo.createdAt,
      real: photo.vaultDistribution.status === "paid",
    };
  }
  return {
    kind: "milestone" as const,
    title: photo.vaultMilestone?.name ?? "Milestone",
    occurredAt: photo.vaultMilestone?.completedAt ?? photo.createdAt,
    real: photo.vaultMilestone?.status === "completed",
  };
}

@Injectable()
export class FieldPhotosService {
  /**
   * Checks the event is a real, non-deleted event OF THIS VAULT — a photo
   * can't be pinned to another vault's delivery.
   */
  private async assertEvent(input: Pick<UploadFieldPhotosInput, "vaultId" | "eventType" | "eventId">) {
    const vault = await prisma.vault.findFirst({ where: { id: input.vaultId, deletedAt: null }, select: { id: true } });
    if (!vault) throw new NotFoundException(`Vault "${input.vaultId}" not found.`);
    const event =
      input.eventType === "distribution"
        ? await prisma.vaultDistribution.findFirst({ where: { id: input.eventId, vaultId: input.vaultId, deletedAt: null }, select: { id: true } })
        : await prisma.vaultMilestone.findFirst({ where: { id: input.eventId, vaultId: input.vaultId, deletedAt: null }, select: { id: true } });
    if (!event) {
      throw new BadRequestException(`That ${input.eventType} doesn't exist on this vault. Photos document a real delivery or milestone of the vault.`);
    }
  }

  /** Validates once, before any file is written — call before storing the images. */
  async validateUpload(input: UploadFieldPhotosInput) {
    if (input.consentConfirmed !== "true") {
      throw new BadRequestException(
        "Confirm that Birr has the right to publish these photos and that everyone identifiable in them (or their guardian, for a child) has consented.",
      );
    }
    await this.assertEvent(input);
  }

  /** One row per stored image, each audit-logged (the audit trail is per record). */
  async createMany(input: UploadFieldPhotosInput, imageUrls: string[], actorUserId: string) {
    await this.validateUpload(input);
    return prisma.$transaction(async (tx) => {
      const created = [];
      for (const imageUrl of imageUrls) {
        const photo = await tx.vaultFieldPhoto.create({
          data: {
            vaultId: input.vaultId,
            vaultDistributionId: input.eventType === "distribution" ? input.eventId : null,
            vaultMilestoneId: input.eventType === "milestone" ? input.eventId : null,
            imageUrl,
            caption: input.caption?.trim() || null,
            consentConfirmed: true,
            uploadedByUserId: actorUserId,
          },
        });
        await tx.auditLog.create({
          data: {
            vaultId: input.vaultId,
            actorType: "birr_staff",
            actorUserId,
            action: "vault_field_photo.uploaded",
            entityType: "VaultFieldPhoto",
            entityId: photo.id,
            after: photo as any,
          },
        });
        created.push(photo);
      }
      return created;
    });
  }

  private async setHidden(id: string, hidden: boolean, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.vaultFieldPhoto.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundException(`Field photo "${id}" not found.`);
      if (hidden === Boolean(before.hiddenAt)) {
        throw new BadRequestException(hidden ? "This photo is already hidden." : "This photo isn't hidden.");
      }
      const photo = await tx.vaultFieldPhoto.update({
        where: { id },
        data: hidden ? { hiddenAt: new Date(), hiddenByUserId: actorUserId } : { hiddenAt: null, hiddenByUserId: null },
      });
      await tx.auditLog.create({
        data: {
          vaultId: before.vaultId,
          actorType: "birr_staff",
          actorUserId,
          action: hidden ? "vault_field_photo.hidden" : "vault_field_photo.unhidden",
          entityType: "VaultFieldPhoto",
          entityId: id,
          before: before as any,
          after: photo as any,
        },
      });
      return photo;
    });
  }

  /** Taking a photo off the public site needs no second person — removing from view is the safe direction. */
  hide(id: string, actorUserId: string) {
    return this.setHidden(id, true, actorUserId);
  }

  unhide(id: string, actorUserId: string) {
    return this.setHidden(id, false, actorUserId);
  }

  /** Soft removal — never a hard delete. */
  async archive(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.vaultFieldPhoto.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundException(`Field photo "${id}" not found.`);
      const photo = await tx.vaultFieldPhoto.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: { vaultId: before.vaultId, actorType: "birr_staff", actorUserId, action: "vault_field_photo.archived", entityType: "VaultFieldPhoto", entityId: id, before: before as any, after: photo as any },
      });
      return photo;
    });
  }

  /** Staff view for one vault: every photo with what it documents and whether it's showing on the homepage yet. */
  async listForVault(vaultId: string) {
    const photos = await prisma.vaultFieldPhoto.findMany({
      where: { vaultId, deletedAt: null },
      include: PHOTO_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return photos.map((p) => {
      const event = eventOf(p);
      const vaultPublic = (PUBLIC_VAULT_STATUSES as readonly string[]).includes(p.vault.status);
      const showing = !p.hiddenAt && event.real && vaultPublic;
      return {
        id: p.id,
        imageUrl: p.imageUrl,
        caption: p.caption,
        kind: event.kind,
        title: event.title,
        hidden: Boolean(p.hiddenAt),
        showing,
        // Why it isn't (yet) public — so staff aren't left guessing.
        waitingFor: showing || p.hiddenAt ? null : !event.real ? (event.kind === "delivery" ? "the delivery to be paid" : "the milestone to be completed") : "the vault to be published",
        createdAt: p.createdAt,
      };
    });
  }

  /**
   * The homepage "impact wall": field photos of paid deliveries and completed
   * milestones, plus the image evidence already attached to completed
   * milestones (public by design on the vault page), newest first. Public:
   * no uploader or staff identifiers are ever returned.
   */
  async listPublic(limit = 24): Promise<PublicFieldPhoto[]> {
    const [photos, milestones] = await Promise.all([
      prisma.vaultFieldPhoto.findMany({
        where: VISIBLE_PHOTO_WHERE,
        include: PHOTO_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.vaultMilestone.findMany({
        where: {
          status: "completed",
          deletedAt: null,
          evidenceFileUrl: { not: null },
          vault: { status: { in: [...PUBLIC_VAULT_STATUSES] }, deletedAt: null },
        },
        select: { id: true, name: true, completedAt: true, evidenceFileUrl: true, vault: { select: { name: true, slug: true } } },
        orderBy: { completedAt: "desc" },
        take: limit,
      }),
    ]);

    const fromPhotos: PublicFieldPhoto[] = photos.map((p) => {
      const event = eventOf(p);
      return {
        id: `photo-${p.id}`,
        imageUrl: p.imageUrl,
        kind: event.kind,
        title: event.title,
        caption: p.caption,
        vaultName: p.vault.name,
        vaultSlug: p.vault.slug,
        occurredAt: event.occurredAt.toISOString(),
      };
    });
    const fromEvidence: PublicFieldPhoto[] = milestones
      .filter((m) => m.evidenceFileUrl && IMAGE_EXTENSION.test(m.evidenceFileUrl))
      .map((m) => ({
        id: `evidence-${m.id}`,
        imageUrl: m.evidenceFileUrl!,
        kind: "milestone" as const,
        title: m.name,
        caption: null,
        vaultName: m.vault.name,
        vaultSlug: m.vault.slug,
        occurredAt: (m.completedAt ?? new Date(0)).toISOString(),
      }));

    return [...fromPhotos, ...fromEvidence].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  }
}
