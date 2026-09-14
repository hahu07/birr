import { NotFoundException } from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { AuditLogsController } from "./audit-logs.controller";
import { signSessionToken, SESSION_COOKIE_NAME } from "../../common/auth/session";

function requestWithFounderCookie(token: string): Request {
  return { cookies: { [SESSION_COOKIE_NAME]: token } } as unknown as Request;
}

function requestWithNoCookie(): Request {
  return { cookies: {} } as unknown as Request;
}

// listMine() never touches this.auditLogsService — it's a direct Prisma
// read, same style as list() above it — so a real instance isn't needed.
const controller = new AuditLogsController(undefined as never);

describe("AuditLogsController.listMine()", () => {
  const founderIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    // audit_logs rows themselves are never deleted — insert-only at the
    // DB role level (UPDATE/DELETE revoked), same reasoning Users aren't
    // deleted either elsewhere in this codebase. Deleting the
    // FounderMembership/Founder fixtures would violate the FK those
    // fixture rows still reference from audit_logs, so those are left in
    // place too, matching this same "audit_logs holds a reference, so
    // the referenced row stays" pattern.
    await prisma.$disconnect();
  });

  async function makeFounderWithUser(label: string) {
    const user = await prisma.user.create({
      data: { email: `audit-logs-controller-${label}-${Date.now()}@example.test`, fullName: `${label} User` },
    });
    userIds.push(user.id);
    const founder = await prisma.founder.create({ data: { name: `${label} Founder`, kind: "individual" } });
    founderIds.push(founder.id);
    await prisma.founderMembership.create({
      data: { userId: user.id, founderId: founder.id, permissionLevel: "primary_contact", status: "active" },
    });
    return { user, founder };
  }

  test("returns only this Founder's own audit log entries, never another Founder's", async () => {
    const mine = await makeFounderWithUser("mine");
    const other = await makeFounderWithUser("other");

    const mineLog = await prisma.auditLog.create({
      data: {
        actorType: "founder_user",
        actorUserId: mine.user.id,
        actorFounderId: mine.founder.id,
        action: "waqf_cause.allocated",
        entityType: "WaqfCause",
        entityId: "irrelevant",
      },
    });
    const otherLog = await prisma.auditLog.create({
      data: {
        actorType: "founder_user",
        actorUserId: other.user.id,
        actorFounderId: other.founder.id,
        action: "waqf_cause.allocated",
        entityType: "WaqfCause",
        entityId: "irrelevant",
      },
    });

    const request = requestWithFounderCookie(signSessionToken(mine.user.id));
    const result = await controller.listMine(request);
    const ids = result.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mineLog.id);
    expect(ids).not.toContain(otherLog.id);
  });

  test("never exposes before/after — only a summary of what happened", async () => {
    const fixture = await makeFounderWithUser("noraw");
    const log = await prisma.auditLog.create({
      data: {
        actorType: "founder_user",
        actorUserId: fixture.user.id,
        actorFounderId: fixture.founder.id,
        action: "foundation_deed.signed",
        entityType: "FoundationDeed",
        entityId: "irrelevant",
        after: { deedText: "sensitive legal text that shouldn't ride along in a list view" } as any,
      },
    });

    const request = requestWithFounderCookie(signSessionToken(fixture.user.id));
    const result = await controller.listMine(request);
    const entry = result.items.find((i: { id: string }) => i.id === log.id);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("before");
    expect(entry).not.toHaveProperty("after");
  });

  test("rejects a request with no session", async () => {
    await expect(controller.listMine(requestWithNoCookie())).rejects.toThrow();
  });

  test("rejects a signed-in user who hasn't established a Foundation yet", async () => {
    const user = await prisma.user.create({
      data: { email: `audit-logs-controller-no-founder-${Date.now()}@example.test`, fullName: "No Founder Yet" },
    });
    userIds.push(user.id);
    const request = requestWithFounderCookie(signSessionToken(user.id));
    await expect(controller.listMine(request)).rejects.toThrow(NotFoundException);
  });
});
