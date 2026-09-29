import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { prisma, Prisma, WaqfType } from "@birr/db";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const NAME_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 500;
const ICON_MAX_LENGTH = 8; // generous — a multi-codepoint emoji, not a URL or asset path.

export class CreateCauseCategoryInput {
  @IsString()
  @IsNotEmpty({ message: "Name is required." })
  @MaxLength(NAME_MAX_LENGTH)
  name!: string;

  @IsString()
  @IsNotEmpty({ message: "Description is required." })
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(ICON_MAX_LENGTH)
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // Staff-curated UX hint only — see the schema's own comment on why
  // this never restricts which types can pick a category.
  @IsOptional()
  @IsArray()
  @IsEnum(WaqfType, { each: true })
  typicalWaqfTypes?: WaqfType[];

  // One level only — see the schema's own comment on CauseCategory.parentId.
  @IsOptional()
  @IsString()
  parentId?: string | null;

  // See CauseCategory.projectPlan's own schema comment — a default
  // template copied into a new VaultCause at selection time, not itself
  // shown to a donor. Same DESCRIPTION_MAX_LENGTH cap as `description`
  // above (deliberately shorter than VaultCause.projectPlan's own
  // 2000-char cap — a generic starting draft, not the full write-up).
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  projectPlan?: string;
}

export class UpdateCauseCategoryInput {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: "Name cannot be blank." })
  @MaxLength(NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: "Description cannot be blank." })
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ICON_MAX_LENGTH)
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(WaqfType, { each: true })
  typicalWaqfTypes?: WaqfType[];

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  projectPlan?: string;
}

function normalize<T extends { name?: string; description?: string; icon?: string; projectPlan?: string }>(input: T): T {
  return {
    ...input,
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.description !== undefined && { description: input.description.trim() || undefined }),
    ...(input.icon !== undefined && { icon: input.icon.trim() || undefined }),
    ...(input.projectPlan !== undefined && { projectPlan: input.projectPlan.trim() || undefined }),
  };
}

@Injectable()
export class CauseCategoriesService {
  // Arbitrary depth (see CauseCategory.parentId's schema comment): the
  // referenced parent must exist and not be retired. The only structural
  // rule left to enforce is acyclicity — a category can't become its own
  // ancestor — since Prisma/Postgres can't express that as a schema
  // constraint. excludeId is the category being created/updated; walking
  // up from the proposed parent and finding excludeId along the way means
  // this assignment would close a loop.
  private async validateParent(
    tx: Prisma.TransactionClient,
    parentId: string | null | undefined,
    excludeId?: string,
  ): Promise<void> {
    if (!parentId) return;
    if (parentId === excludeId) {
      throw new BadRequestException("A category cannot be its own parent.");
    }
    const parent = await tx.causeCategory.findUnique({ where: { id: parentId } });
    if (!parent || parent.deletedAt) {
      throw new BadRequestException(`CauseCategory "${parentId}" not found.`);
    }
    if (excludeId) {
      let cursor = parent.parentId;
      const visited = new Set<string>();
      while (cursor) {
        if (cursor === excludeId) {
          throw new BadRequestException("This would create a circular category hierarchy.");
        }
        if (visited.has(cursor)) break; // defensive — shouldn't happen, existing data is acyclic
        visited.add(cursor);
        const ancestor = await tx.causeCategory.findUnique({ where: { id: cursor }, select: { parentId: true } });
        cursor = ancestor?.parentId ?? null;
      }
    }
  }

  // Platform config, same audited-but-not-governed_actions posture as
  // CompliancePolicySetsService — a Founder-visible catalog, not a
  // fiduciary decision about a specific waqf's assets.
  async create(input: CreateCauseCategoryInput, actorUserId: string) {
    const data = normalize(input);
    // class-validator's IsNotEmpty passes a whitespace-only string (it
    // only rejects ""); normalize() then trims it down to "" itself, so
    // catch that case explicitly rather than letting a blank description
    // slip through as a silently-null DB value.
    if (!data.description) {
      throw new BadRequestException("Description is required.");
    }
    try {
      return await prisma.$transaction(async (tx) => {
        await this.validateParent(tx, data.parentId);
        const category = await tx.causeCategory.create({ data });
        await tx.auditLog.create({
          data: {
            actorType: "birr_staff",
            actorUserId,
            action: "cause_category.created",
            entityType: "CauseCategory",
            entityId: category.id,
            after: category as any,
          },
        });
        return category;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(`A cause category named "${data.name}" already exists.`);
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateCauseCategoryInput, actorUserId: string) {
    // Same whitespace-only gap as create() — check the raw (pre-trim)
    // input, since normalize() would otherwise turn a blank description
    // into `undefined` (meaning "leave unchanged") instead of rejecting it.
    if (input.description !== undefined && !input.description.trim()) {
      throw new BadRequestException("Description cannot be blank.");
    }
    const data = normalize(input);
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.causeCategory.findUnique({ where: { id } });
        if (!existing || existing.deletedAt) {
          throw new NotFoundException(`CauseCategory "${id}" not found.`);
        }
        if (data.parentId !== undefined) {
          await this.validateParent(tx, data.parentId, id);
        }
        const category = await tx.causeCategory.update({ where: { id }, data });
        await tx.auditLog.create({
          data: {
            actorType: "birr_staff",
            actorUserId,
            action: "cause_category.updated",
            entityType: "CauseCategory",
            entityId: category.id,
            before: existing as any,
            after: category as any,
          },
        });
        return category;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(`A cause category named "${data.name}" already exists.`);
      }
      throw err;
    }
  }

  // Soft-delete only — see the model's own schema comment for why: a
  // Founder may already have selected this category for a waqf, and that
  // WaqfCause row's own name/description must keep displaying correctly
  // (they were copied in at selection time, not a live lookup).
  async retire(id: string, actorUserId: string): Promise<void> {
    await this.setRetired(id, new Date(), "cause_category.retired", actorUserId);
  }

  async restore(id: string, actorUserId: string): Promise<void> {
    await this.setRetired(id, null, "cause_category.restored", actorUserId);
  }

  private async setRetired(id: string, deletedAt: Date | null, action: string, actorUserId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.causeCategory.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`CauseCategory "${id}" not found.`);
      const category = await tx.causeCategory.update({ where: { id }, data: { deletedAt } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action,
          entityType: "CauseCategory",
          entityId: category.id,
          before: existing as any,
          after: category as any,
        },
      });
    });
  }

  // Sets/replaces the optional template document attached to this
  // category's `projectPlan` — see CauseCategory.projectPlanFileUrl's
  // own schema comment. Plain CRUD, same posture as create()/update()
  // above (a catalog edit, not a fiduciary decision about a specific
  // waqf/vault), audited the same way.
  async setProjectPlanFile(id: string, url: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.causeCategory.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        throw new NotFoundException(`CauseCategory "${id}" not found.`);
      }
      const category = await tx.causeCategory.update({ where: { id }, data: { projectPlanFileUrl: url } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "cause_category.project_plan_file_updated",
          entityType: "CauseCategory",
          entityId: category.id,
          before: { projectPlanFileUrl: existing.projectPlanFileUrl } as any,
          after: { projectPlanFileUrl: category.projectPlanFileUrl } as any,
        },
      });
      return category;
    });
  }

  // includeRetired is staff-admin-screen-only (see controller) — a
  // Founder picking a cause for their waqf, or an anonymous caller,
  // should only ever see options currently on offer. usageCount (active
  // WaqfCause selections referencing this category) rides along so the
  // admin screen can warn before retiring something Founders are
  // actively relying on — retiring never breaks those selections, but a
  // human should still see the blast radius before doing it.
  async list(includeRetired: boolean) {
    const categories = await prisma.causeCategory.findMany({
      where: includeRetired ? undefined : { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        _count: {
          select: { waqfCauses: { where: { deletedAt: null } }, vaultCauses: { where: { deletedAt: null } } },
        },
      },
    });
    // Vault causes count too — both products pick from this one catalog,
    // and counting only waqfs understated the blast radius of a retire.
    return categories.map(({ _count, ...category }) => ({
      ...category,
      usageCount: _count.waqfCauses + _count.vaultCauses,
      waqfUsageCount: _count.waqfCauses,
      vaultUsageCount: _count.vaultCauses,
    }));
  }
}
