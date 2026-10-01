import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import {
  BLOG_CATEGORY_KEYS,
  BLOG_ILLUSTRATION_KEYS,
  BLOG_SLUG_PATTERN,
  readMinutes,
} from "./blog.constants";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export class CreateBlogArticleInput {
  @Matches(BLOG_SLUG_PATTERN, {
    message: 'slug must be lowercase letters, digits, and single hyphens only (e.g. "what-is-a-waqf").',
  })
  @MaxLength(120)
  slug!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(300)
  description!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60_000)
  body!: string;

  @IsIn(BLOG_CATEGORY_KEYS)
  category!: string;

  @IsIn(BLOG_ILLUSTRATION_KEYS)
  illustration!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  authorName!: string;
}

export class UpdateBlogArticleInput {
  @IsOptional()
  @Matches(BLOG_SLUG_PATTERN, { message: "slug must be lowercase letters, digits, and single hyphens only." })
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60_000)
  body?: string;

  @IsOptional()
  @IsIn(BLOG_CATEGORY_KEYS)
  category?: string;

  @IsOptional()
  @IsIn(BLOG_ILLUSTRATION_KEYS)
  illustration?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  authorName?: string;
}

// Exactly what a public visitor's browser may see — never
// createdByUserId/reviewedByUserId (they identify staff by internal id).
// reviewedByName is the deliberate public byline.
const PUBLIC_SELECT = {
  slug: true,
  title: true,
  description: true,
  category: true,
  illustration: true,
  authorName: true,
  reviewedByName: true,
  publishedAt: true,
} satisfies Prisma.BlogArticleSelect;

async function findArticleOrThrow(tx: Prisma.TransactionClient, id: string) {
  const article = await tx.blogArticle.findFirst({ where: { id, deletedAt: null } });
  if (!article) throw new NotFoundException(`Blog article "${id}" not found.`);
  return article;
}

@Injectable()
export class BlogService {
  /**
   * Plain staff CRUD — drafting is not a governed action (nothing here
   * is public). Always starts as `draft`; going live is only possible
   * through the governed `blog.publish` action (see publish() below).
   */
  async create(input: CreateBlogArticleInput, actorUserId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const article = await tx.blogArticle.create({ data: { ...input, createdByUserId: actorUserId } });
        await tx.auditLog.create({
          data: {
            actorType: "birr_staff",
            actorUserId,
            action: "blog_article.created",
            entityType: "BlogArticle",
            entityId: article.id,
            after: article as any,
          },
        });
        return article;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(`The slug "${input.slug}" is already used by another article.`);
      }
      throw err;
    }
  }

  /**
   * Drafts only. A published article's text is what a reviewer actually
   * approved — letting it be edited in place would let anyone change
   * approved wording without it ever being reviewed again. To change a
   * live article: unpublish() it back to draft, edit, then propose
   * publishing again.
   */
  async update(id: string, input: UpdateBlogArticleInput, actorUserId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const before = await findArticleOrThrow(tx, id);
        if (before.status !== "draft") {
          throw new BadRequestException(
            `Article "${before.title}" is "${before.status}" — only a draft can be edited. Unpublish it first so changes go back through review.`,
          );
        }
        const article = await tx.blogArticle.update({ where: { id }, data: input });
        await tx.auditLog.create({
          data: {
            actorType: "birr_staff",
            actorUserId,
            action: "blog_article.updated",
            entityType: "BlogArticle",
            entityId: id,
            before: before as any,
            after: article as any,
          },
        });
        return article;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        throw new ConflictException(`The slug "${input.slug}" is already used by another article.`);
      }
      throw err;
    }
  }

  /**
   * Internal only — never behind a controller route. `blog.publish` is a
   * governed action; the only caller is GovernedActionsService's handler
   * on approval, inside its own transaction. The approving checker is
   * recorded on the row (and a DB CHECK refuses a published row without
   * one, or one whose reviewer is also its author).
   */
  async publish(id: string, tx: Prisma.TransactionClient, reviewerUserId: string) {
    const article = await findArticleOrThrow(tx, id);
    if (article.status !== "draft") {
      throw new BadRequestException(`Article "${article.title}" is "${article.status}", not "draft" — nothing to publish.`);
    }
    if (article.createdByUserId === reviewerUserId) {
      throw new BadRequestException("An article's author cannot also be the reviewer who approves it for publication.");
    }
    const reviewer = await tx.user.findUniqueOrThrow({ where: { id: reviewerUserId }, select: { fullName: true } });
    return tx.blogArticle.update({
      where: { id },
      data: {
        status: "published",
        publishedAt: new Date(),
        reviewedByUserId: reviewerUserId,
        reviewedByName: reviewer.fullName,
      },
    });
  }

  /**
   * Taking content *down* needs no second person — removing something
   * from public view is the safe direction (same posture as closing a
   * vault). The reviewer/publishedAt are cleared so a later re-publish
   * must earn a fresh approval.
   */
  async unpublish(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await findArticleOrThrow(tx, id);
      if (before.status !== "published") {
        throw new BadRequestException(`Article "${before.title}" is "${before.status}", not "published".`);
      }
      const article = await tx.blogArticle.update({
        where: { id },
        data: { status: "draft", publishedAt: null, reviewedByUserId: null, reviewedByName: null },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "blog_article.unpublished",
          entityType: "BlogArticle",
          entityId: id,
          before: before as any,
          after: article as any,
        },
      });
      return article;
    });
  }

  /** Soft removal — never a hard delete. Reachable from draft or published. */
  async archive(id: string, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const before = await findArticleOrThrow(tx, id);
      if (before.status === "archived") {
        throw new BadRequestException(`Article "${before.title}" is already archived.`);
      }
      const article = await tx.blogArticle.update({
        where: { id },
        data: { status: "archived", deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "blog_article.archived",
          entityType: "BlogArticle",
          entityId: id,
          before: before as any,
          after: article as any,
        },
      });
      return article;
    });
  }

  findById(id: string) {
    return prisma.blogArticle.findFirst({ where: { id, deletedAt: null } });
  }

  /** Ops Console listing — every non-archived article, any status. */
  listForStaff() {
    return prisma.blogArticle.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: "desc" } });
  }

  /** Public listing: published only, no body, with a computed read time. */
  async listPublic(limit?: number) {
    const rows = await prisma.blogArticle.findMany({
      where: { status: "published", deletedAt: null },
      orderBy: { publishedAt: "desc" },
      take: limit,
      select: { ...PUBLIC_SELECT, body: true },
    });
    return rows.map(({ body, ...rest }) => ({ ...rest, readMinutes: readMinutes(body) }));
  }

  /** Public single article. Draft/archived slugs 404 identically to nonexistent ones. */
  async findPublicBySlug(slug: string) {
    const row = await prisma.blogArticle.findFirst({
      where: { slug, status: "published", deletedAt: null },
      select: { ...PUBLIC_SELECT, body: true },
    });
    return row ? { ...row, readMinutes: readMinutes(row.body) } : null;
  }
}
