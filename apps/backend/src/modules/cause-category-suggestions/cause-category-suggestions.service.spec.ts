import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { CauseCategorySuggestionsService } from "./cause-category-suggestions.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";

describe("CauseCategorySuggestionsService", () => {
  const service = new CauseCategorySuggestionsService(createFakeNotificationsService());

  const causeCategoryIds: string[] = [];
  const suggestionIds: string[] = [];
  const waqfIds: string[] = [];

  let founderId: string;
  let otherFounderId: string;
  let founderUserId: string;
  let reviewerUserId: string;
  let ownWaqfId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff/Founders not cleaned up in afterAll — same
    // reasoning as every other spec in this codebase (audit_logs
    // references, insert-only at the DB role level).
    const founderUser = await prisma.user.create({
      data: { email: `cause-suggestions-founder-${Date.now()}@example.com`, fullName: "Fixture Founder User" },
    });
    founderUserId = founderUser.id;

    const founder = await prisma.founder.create({ data: { name: "Cause Suggestions Fixture Founder", kind: "institution" } });
    founderId = founder.id;
    const otherFounder = await prisma.founder.create({ data: { name: "Cause Suggestions Fixture Other Founder", kind: "institution" } });
    otherFounderId = otherFounder.id;

    const foundation = await prisma.foundation.create({ data: { name: "Cause Suggestions Fixture Foundation" } });
    await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId } });

    const waqf = await prisma.waqf.create({
      data: { name: "Cause Suggestions Fixture Waqf", type: "asset", jurisdiction: "AE", foundationId: foundation.id },
    });
    ownWaqfId = waqf.id;
    waqfIds.push(waqf.id);

    const reviewerUser = await prisma.user.create({
      data: { email: `cause-suggestions-reviewer-${Date.now()}@example.com`, fullName: "Fixture Reviewer" },
    });
    reviewerUserId = reviewerUser.id;
    await prisma.birrStaff.create({
      data: { userId: reviewerUser.id, staffRole: "platform_admin" },
    });
  });

  afterAll(async () => {
    await prisma.causeCategorySuggestion.deleteMany({ where: { id: { in: suggestionIds } } });
    await prisma.causeCategory.deleteMany({ where: { id: { in: causeCategoryIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.$disconnect();
  });

  function fixtureName(label: string) {
    return `Cause Suggestion Fixture ${label} ${randomUUID()}`;
  }

  test("propose() writes the row and a matching audit_logs record attributed to the founder", async () => {
    const suggestion = await service.propose({ name: fixtureName("Propose") }, founderId, founderUserId);
    suggestionIds.push(suggestion.id);
    expect(suggestion.status).toBe("pending");

    const logs = await prisma.auditLog.findMany({
      where: { entityId: suggestion.id, action: "cause_category_suggestion.proposed" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "founder_user", actorUserId: founderUserId, actorFounderId: founderId });
  });

  test("propose() accepts a waqfId the founder actually owns", async () => {
    const suggestion = await service.propose({ name: fixtureName("OwnWaqf"), waqfId: ownWaqfId }, founderId, founderUserId);
    suggestionIds.push(suggestion.id);
    expect(suggestion.waqfId).toBe(ownWaqfId);
  });

  test("propose() rejects a waqfId that doesn't belong to the founder", async () => {
    await expect(
      service.propose({ name: fixtureName("NotOwnWaqf"), waqfId: ownWaqfId }, otherFounderId, founderUserId),
    ).rejects.toThrow(BadRequestException);
  });

  describe("approve()/reject()", () => {
    let pendingId: string;

    beforeEach(async () => {
      const suggestion = await service.propose({ name: fixtureName("Reviewable") }, founderId, founderUserId);
      pendingId = suggestion.id;
      suggestionIds.push(suggestion.id);
    });

    test("approve() creates a real CauseCategory, marks the suggestion approved, and writes two audit logs", async () => {
      const reviewed = await service.approve(pendingId, { description: "A real description." }, reviewerUserId);
      expect(reviewed.status).toBe("approved");
      expect(reviewed.resultingCategoryId).not.toBeNull();
      causeCategoryIds.push(reviewed.resultingCategoryId!);

      const category = await prisma.causeCategory.findUnique({ where: { id: reviewed.resultingCategoryId! } });
      expect(category).not.toBeNull();
      expect(category!.description).toBe("A real description.");

      const suggestionLogs = await prisma.auditLog.findMany({
        where: { entityId: pendingId, action: "cause_category_suggestion.approved" },
      });
      expect(suggestionLogs).toHaveLength(1);
      expect(suggestionLogs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: reviewerUserId });

      const categoryLogs = await prisma.auditLog.findMany({
        where: { entityId: reviewed.resultingCategoryId!, action: "cause_category.created" },
      });
      expect(categoryLogs).toHaveLength(1);
    });

    test("approve() rejects a blank description", async () => {
      await expect(service.approve(pendingId, { description: "   " }, reviewerUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    test("approve() rejects a name that collides with an existing CauseCategory", async () => {
      const suggestion = await prisma.causeCategorySuggestion.findUnique({ where: { id: pendingId } });
      const existing = await prisma.causeCategory.create({
        data: { name: suggestion!.name, description: "Pre-existing." },
      });
      causeCategoryIds.push(existing.id);

      await expect(service.approve(pendingId, { description: "Whatever." }, reviewerUserId)).rejects.toThrow(
        ConflictException,
      );
    });

    test("reject() marks the suggestion rejected with reviewNotes, and writes an audit log", async () => {
      const reviewed = await service.reject(pendingId, { reviewNotes: "Not a good fit for the catalog." }, reviewerUserId);
      expect(reviewed.status).toBe("rejected");
      expect(reviewed.reviewNotes).toBe("Not a good fit for the catalog.");

      const logs = await prisma.auditLog.findMany({
        where: { entityId: pendingId, action: "cause_category_suggestion.rejected" },
      });
      expect(logs).toHaveLength(1);
    });

    test("reject() rejects a suggestion that's already been reviewed", async () => {
      await service.reject(pendingId, { reviewNotes: "First review." }, reviewerUserId);
      await expect(
        service.reject(pendingId, { reviewNotes: "Second review attempt." }, reviewerUserId),
      ).rejects.toThrow(BadRequestException);
    });

    test("approve() rejects an unknown id", async () => {
      await expect(
        service.approve("00000000-0000-0000-0000-000000000000", { description: "Whatever." }, reviewerUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  test("list() returns every suggestion regardless of proposer", async () => {
    const suggestion = await service.propose({ name: fixtureName("ListAll") }, founderId, founderUserId);
    suggestionIds.push(suggestion.id);

    const list = await service.list();
    expect(list.some((s) => s.id === suggestion.id)).toBe(true);
  });

  test("listForFounder() returns only that founder's own suggestions", async () => {
    const mine = await service.propose({ name: fixtureName("Mine") }, founderId, founderUserId);
    suggestionIds.push(mine.id);
    const theirs = await service.propose({ name: fixtureName("Theirs") }, otherFounderId, founderUserId);
    suggestionIds.push(theirs.id);

    const list = await service.listForFounder(founderId);
    expect(list.some((s) => s.id === mine.id)).toBe(true);
    expect(list.some((s) => s.id === theirs.id)).toBe(false);
  });
});
