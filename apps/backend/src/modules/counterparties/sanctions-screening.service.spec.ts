import { prisma } from "@birr/db";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SanctionsScreeningService } from "./sanctions-screening.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { FakeScreeningAdapter } from "./test-support/fake-screening-adapter";

describe("SanctionsScreeningService", () => {
  const screeningAdapter = new FakeScreeningAdapter();
  const service = new SanctionsScreeningService(screeningAdapter as any, new EncryptionService());

  const counterpartyIds: string[] = [];
  let actorUserId: string;

  beforeAll(async () => {
    const actorUser = await prisma.user.create({
      data: { email: `sanctions-screening-actor-${Date.now()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "compliance_officer" } });
  });

  afterAll(async () => {
    await prisma.sanctionsScreening.deleteMany({ where: { counterpartyId: { in: counterpartyIds } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: counterpartyIds } } });
    await prisma.$disconnect();
  });

  async function fixtureCounterparty(name: string) {
    const counterparty = await prisma.counterparty.create({
      data: { name, institutionType: "bank", jurisdiction: "AE" },
    });
    counterpartyIds.push(counterparty.id);
    return counterparty;
  }

  describe("screen()", () => {
    test("persists a clear result", async () => {
      const counterparty = await fixtureCounterparty(`Clear Fixture ${Date.now()}`);
      screeningAdapter.nextResult = { status: "clear", raw: { match: false } };

      const screening = await prisma.$transaction((tx) => service.screen(counterparty.id, counterparty.name, tx));

      expect(screening.status).toBe("clear");
      expect(screening.screenedName).toBe(counterparty.name);
      expect(screening.errorMessage).toBeNull();
    });

    test("persists a hit result with the encrypted raw response", async () => {
      const counterparty = await fixtureCounterparty(`Hit Fixture ${Date.now()}`);
      screeningAdapter.nextResult = { status: "hit", raw: { match: true, matches: [{ list: "OFAC" }] } };

      const screening = await prisma.$transaction((tx) => service.screen(counterparty.id, counterparty.name, tx));

      expect(screening.status).toBe("hit");
      expect(screening.rawResponseEncrypted).not.toBeNull();
      // Never stored in plaintext — same posture as every other
      // encrypted PII blob in this codebase.
      expect(screening.rawResponseEncrypted).not.toContain("OFAC");
    });

    test("persists an error result with the error message, not a thrown exception", async () => {
      const counterparty = await fixtureCounterparty(`Error Fixture ${Date.now()}`);
      screeningAdapter.nextResult = { status: "error", raw: null, errorMessage: "Simulated vendor outage" };

      const screening = await prisma.$transaction((tx) => service.screen(counterparty.id, counterparty.name, tx));

      expect(screening.status).toBe("error");
      expect(screening.errorMessage).toBe("Simulated vendor outage");
    });
  });

  describe("resolve()", () => {
    test("clears a hit, records who/when/why, and audit-logs it", async () => {
      const counterparty = await fixtureCounterparty(`Resolve Fixture ${Date.now()}`);
      screeningAdapter.nextResult = { status: "hit", raw: { match: true } };
      const screening = await prisma.$transaction((tx) => service.screen(counterparty.id, counterparty.name, tx));

      const resolved = await service.resolve(screening.id, "Investigated — false positive, different date of birth.", actorUserId);

      expect(resolved.status).toBe("cleared");
      expect(resolved.resolvedByUserId).toBe(actorUserId);
      expect(resolved.resolutionNotes).toBe("Investigated — false positive, different date of birth.");
      expect(resolved.resolvedAt).not.toBeNull();

      const logs = await prisma.auditLog.findMany({ where: { entityId: screening.id, action: "sanctions_screening.resolved" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId });
    });

    test("rejects resolving a screening that's already clear", async () => {
      const counterparty = await fixtureCounterparty(`Already Clear Fixture ${Date.now()}`);
      screeningAdapter.nextResult = { status: "clear", raw: { match: false } };
      const screening = await prisma.$transaction((tx) => service.screen(counterparty.id, counterparty.name, tx));

      await expect(service.resolve(screening.id, "Not needed", actorUserId)).rejects.toThrow(BadRequestException);
    });

    test("throws NotFoundException for an unknown screening id", async () => {
      await expect(service.resolve("00000000-0000-0000-0000-000000000000", "x", actorUserId)).rejects.toThrow(NotFoundException);
    });
  });

  describe("latestFor()", () => {
    test("returns the most recent screening, null when none exists", async () => {
      const counterparty = await fixtureCounterparty(`Latest Fixture ${Date.now()}`);
      expect(await service.latestFor(counterparty.id)).toBeNull();

      screeningAdapter.nextResult = { status: "clear", raw: { match: false } };
      await prisma.$transaction((tx) => service.screen(counterparty.id, counterparty.name, tx));
      screeningAdapter.nextResult = { status: "hit", raw: { match: true } };
      const second = await prisma.$transaction((tx) => service.screen(counterparty.id, counterparty.name, tx));

      const latest = await service.latestFor(counterparty.id);
      expect(latest?.id).toBe(second.id);
      expect(latest?.status).toBe("hit");
    });
  });
});
