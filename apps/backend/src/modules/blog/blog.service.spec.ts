import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { BlogService } from "./blog.service";

describe("BlogService", () => {
  const service = new BlogService();
  const articleIds: string[] = [];
  let authorUserId: string;
  let reviewerUserId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff not cleaned up — audit_logs references them
    // and that table is insert-only at the DB role level.
    const author = await prisma.user.create({
      data: { email: `blog-author-${Date.now()}@example.com`, fullName: "Blog Author" },
    });
    authorUserId = author.id;
    await prisma.birrStaff.create({ data: { userId: author.id, staffRole: "mutawalli_officer" } });
    const reviewer = await prisma.user.create({
      data: { email: `blog-reviewer-${Date.now()}@example.com`, fullName: "Blog Reviewer" },
    });
    reviewerUserId = reviewer.id;
    await prisma.birrStaff.create({ data: { userId: reviewer.id, staffRole: "legal_adviser" } });
  });

  afterAll(async () => {
    await prisma.blogArticle.deleteMany({ where: { id: { in: articleIds } } });
    await prisma.$disconnect();
  });

  const uniqueSlug = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  async function newArticle(overrides: Partial<{ slug: string; body: string }> = {}) {
    const article = await service.create(
      {
        slug: overrides.slug ?? uniqueSlug("article"),
        title: "A test article",
        description: "A description long enough to pass.",
        body: overrides.body ?? "Some body text.",
        category: "trust",
        illustration: "endowment",
        authorName: "Birr Editorial",
      },
      authorUserId,
    );
    articleIds.push(article.id);
    return article;
  }

  const publish = (id: string, reviewer = reviewerUserId) => prisma.$transaction((tx) => service.publish(id, tx, reviewer));

  test("create() starts as a draft and writes an audit_logs record attributed to the author", async () => {
    const article = await newArticle();
    expect(article.status).toBe("draft");
    expect(article.reviewedByUserId).toBeNull();
    const logs = await prisma.auditLog.findMany({ where: { entityId: article.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: authorUserId, action: "blog_article.created" });
  });

  test("create() rejects a duplicate slug with a clear conflict, not a raw 500", async () => {
    const first = await newArticle();
    await expect(newArticle({ slug: first.slug })).rejects.toThrow(ConflictException);
  });

  test("update() edits a draft and audit-logs before/after", async () => {
    const article = await newArticle();
    const updated = await service.update(article.id, { title: "A new title" }, authorUserId);
    expect(updated.title).toBe("A new title");
    const logs = await prisma.auditLog.findMany({ where: { entityId: article.id, action: "blog_article.updated" } });
    expect(logs).toHaveLength(1);
    expect((logs[0].before as any).title).toBe("A test article");
    expect((logs[0].after as any).title).toBe("A new title");
  });

  test("update() refuses to edit a published article — it must be unpublished first", async () => {
    const article = await newArticle();
    await publish(article.id);
    await expect(service.update(article.id, { body: "Sneaky edit" }, authorUserId)).rejects.toThrow(BadRequestException);
  });

  test("publish() records the reviewer's name and refuses the article's own author", async () => {
    const article = await newArticle();
    await expect(publish(article.id, authorUserId)).rejects.toThrow(BadRequestException);

    const published = await publish(article.id);
    expect(published.status).toBe("published");
    expect(published.reviewedByUserId).toBe(reviewerUserId);
    expect(published.reviewedByName).toBe("Blog Reviewer");
    expect(published.publishedAt).not.toBeNull();
  });

  test("publish() refuses an article that isn't a draft", async () => {
    const article = await newArticle();
    await publish(article.id);
    await expect(publish(article.id)).rejects.toThrow(BadRequestException);
  });

  test("unpublish() returns it to draft, clears the reviewer, and audit-logs; edits are possible again", async () => {
    const article = await newArticle();
    await publish(article.id);
    const draft = await service.unpublish(article.id, authorUserId);
    expect(draft).toMatchObject({ status: "draft", reviewedByUserId: null, reviewedByName: null, publishedAt: null });
    expect(await prisma.auditLog.count({ where: { entityId: article.id, action: "blog_article.unpublished" } })).toBe(1);
    await expect(service.update(article.id, { title: "Edited after unpublish" }, authorUserId)).resolves.toBeDefined();
  });

  test("archive() soft-removes (never hard-deletes) and audit-logs", async () => {
    const article = await newArticle();
    await service.archive(article.id, authorUserId);
    expect(await service.findById(article.id)).toBeNull();
    const row = await prisma.blogArticle.findUnique({ where: { id: article.id } });
    expect(row).toMatchObject({ status: "archived" });
    expect(row?.deletedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: article.id, action: "blog_article.archived" } })).toBe(1);
    await expect(service.archive(article.id, authorUserId)).rejects.toThrow(NotFoundException);
  });

  test("the public listing and slug lookup expose published articles only, with no staff ids", async () => {
    const draft = await newArticle();
    const live = await newArticle({ body: "word ".repeat(450) });
    await publish(live.id);

    const list = await service.listPublic();
    expect(list.some((a) => a.slug === live.slug)).toBe(true);
    expect(list.some((a) => a.slug === draft.slug)).toBe(false);

    const item = list.find((a) => a.slug === live.slug)!;
    expect(item.readMinutes).toBe(2);
    expect(item).not.toHaveProperty("body");
    expect(item).not.toHaveProperty("createdByUserId");
    expect(item).not.toHaveProperty("reviewedByUserId");

    const single = await service.findPublicBySlug(live.slug);
    expect(single?.body).toContain("word");
    expect(single).not.toHaveProperty("createdByUserId");
    expect(await service.findPublicBySlug(draft.slug)).toBeNull();
  });
});
