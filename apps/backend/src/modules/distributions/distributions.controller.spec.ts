import { UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { prisma } from "@birr/db";
import { DistributionsController } from "./distributions.controller";
import { signSessionToken, SESSION_COOKIE_NAME, STAFF_SESSION_COOKIE_NAME } from "../../common/auth/session";

function requestWithFounderCookie(token: string): Request {
  return { cookies: { [SESSION_COOKIE_NAME]: token } } as unknown as Request;
}

function requestWithStaffCookie(token: string): Request {
  return { cookies: { [STAFF_SESSION_COOKIE_NAME]: token } } as unknown as Request;
}

function requestWithNoCookie(): Request {
  return { cookies: {} } as unknown as Request;
}

// Regression coverage for a real, previously-shipped PII leak (2026-08-30
// security audit fix, see docs/comprehensive-code-review-prompt.md and
// this route's own comment): GET /distributions/summary used to fall
// through to the staff-only includeBeneficiaryNames: true branch for ANY
// request lacking a recognizable staff session — including a fully
// anonymous caller with no session cookie at all. The fix added an
// explicit hasAnySessionCookie() check before the isBirrStaffSession()
// branch. This spec exercises the controller's actual routing logic with
// real session cookies (not the service directly, which already has its
// own includeBeneficiaryNames coverage in distributions.service.spec.ts)
// — a stub service lets these tests assert WHICH branch each caller
// reaches without re-testing the service's own PII-shaping logic.
describe("DistributionsController.summary() — session routing never leaks beneficiary PII", () => {
  let staffUserId: string;
  let founderUserId: string;
  let founderId: string;

  beforeAll(async () => {
    // Fixture User/BirrStaff/Founder/FounderMembership rows not cleaned
    // up in afterAll — same reasoning as every other spec in this
    // codebase (audit_logs references them, and that table is
    // insert-only at the DB role level).
    // mfaEnabled: true — isBirrStaffSession() defaults to requireMfa:
    // true (fail-closed), so a staff fixture without this would never
    // resolve as a staff session at all, regardless of the thing this
    // spec is actually testing.
    const staffUser = await prisma.user.create({
      data: { email: `distributions-controller-staff-${Date.now()}@example.test`, fullName: "Staff, Reviewing Summary", mfaEnabled: true },
    });
    staffUserId = staffUser.id;
    await prisma.birrStaff.create({ data: { userId: staffUserId, staffRole: "mutawalli_officer" } });

    const founderUser = await prisma.user.create({
      data: { email: `distributions-controller-founder-${Date.now()}@example.test`, fullName: "Founder, Viewing Own Summary" },
    });
    founderUserId = founderUser.id;
    const founder = await prisma.founder.create({ data: { name: "Distributions Controller Fixture Founder", kind: "institution" } });
    founderId = founder.id;
    await prisma.founderMembership.create({
      data: { founderId, userId: founderUserId, permissionLevel: "primary_contact" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function fakeService() {
    return {
      summaryByCauseForFounder: jest.fn().mockResolvedValue([{ causeId: "c1", beneficiaryCount: 2 }]),
      summaryByCause: jest.fn().mockResolvedValue([{ causeId: "c1", beneficiaryNames: ["Real Name"] }]),
    };
  }

  test("rejects a request with no session cookie at all — never falls through to the staff branch", async () => {
    const service = fakeService();
    const controller = new DistributionsController(service as any);

    await expect(controller.summary("waqf-1", requestWithNoCookie())).rejects.toThrow(UnauthorizedException);
    expect(service.summaryByCause).not.toHaveBeenCalled();
    expect(service.summaryByCauseForFounder).not.toHaveBeenCalled();
  });

  test("a Founder session gets the Founder-safe summary — summaryByCause (the names-capable path) is never called", async () => {
    const service = fakeService();
    const controller = new DistributionsController(service as any);

    const result = await controller.summary("waqf-1", requestWithFounderCookie(signSessionToken(founderUserId)));

    expect(service.summaryByCauseForFounder).toHaveBeenCalledWith("waqf-1", founderId);
    expect(service.summaryByCause).not.toHaveBeenCalled();
    expect(result).toEqual([{ causeId: "c1", beneficiaryCount: 2 }]);
  });

  test("a staff session gets includeBeneficiaryNames: true — the Founder branch is never called", async () => {
    const service = fakeService();
    const controller = new DistributionsController(service as any);

    const result = await controller.summary("waqf-1", requestWithStaffCookie(signSessionToken(staffUserId)));

    expect(service.summaryByCause).toHaveBeenCalledWith("waqf-1", undefined, true);
    expect(service.summaryByCauseForFounder).not.toHaveBeenCalled();
    expect(result).toEqual([{ causeId: "c1", beneficiaryNames: ["Real Name"] }]);
  });
});
