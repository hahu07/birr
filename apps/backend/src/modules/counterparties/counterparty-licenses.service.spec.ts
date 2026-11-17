import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { REQUIRED_COUNTERPARTY_LICENSES } from "@birr/shared";
import { CounterpartiesService } from "./counterparties.service";
import { assertLicensesCurrent, CounterpartyLicensesService, lagosToday, licenseRequirements } from "./counterparty-licenses.service";
import { noticeDue, sendLicenseExpiryNotices } from "./counterparty-license-expiry-scheduler";
import { EncryptionService } from "../../common/settings/encryption.service";

// Fixtures stay behind: licences are never deleted (a trigger), so neither
// are the counterparties and users they name — same as audit_logs.
describe("CounterpartyLicensesService", () => {
  const service = new CounterpartyLicensesService();
  const counterparties = new CounterpartiesService(new EncryptionService());
  const required = REQUIRED_COUNTERPARTY_LICENSES.healthcare_provider!;
  let recorderUserId: string;
  let verifierUserId: string;

  const inDays = (days: number) => new Date(Date.parse(`${lagosToday()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  async function staff(role: "mutawalli_officer" | "compliance_officer", label: string) {
    const user = await prisma.user.create({ data: { email: `licenses-${label}-${randomUUID()}@example.com`, fullName: `Licence ${label}` } });
    await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role } } } });
    return user.id;
  }

  async function provider(overrides: { status?: "active" | "pending_review"; shariahApproved?: boolean } = {}) {
    return prisma.counterparty.create({
      data: {
        name: `Fixture Clinic Operator ${randomUUID()}`,
        institutionType: "healthcare_provider",
        jurisdiction: "NG",
        businessActivities: "Runs a laboratory and clinic for women and young children.",
        status: overrides.status ?? "active",
        shariahApprovedAt: overrides.shariahApproved ? new Date() : null,
      },
    });
  }

  async function recordAndVerify(counterpartyId: string, kind: (typeof required)[number], expiresOn = inDays(365)) {
    const license = await service.record(
      counterpartyId,
      { kind, licenseNumber: `LIC-${randomUUID().slice(0, 8)}1`, issuingAuthority: "Oyo State Ministry of Health", expiresOn },
      recorderUserId,
    );
    return service.verify(license.id, { note: "Saw the original certificate." }, verifierUserId);
  }

  async function fullyLicensed(counterpartyId: string, expiresOn = inDays(365)) {
    for (const kind of required) await recordAndVerify(counterpartyId, kind, expiresOn);
  }

  beforeAll(async () => {
    recorderUserId = await staff("mutawalli_officer", "recorder");
    verifierUserId = await staff("compliance_officer", "verifier");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("recording", () => {
    test("records what the certificate says, unverified, and audits it", async () => {
      const cp = await provider();
      const license = await service.record(
        cp.id,
        { kind: "medical_laboratory_registration", licenseNumber: "MLSCN/123", issuingAuthority: "MLSCN", issuedOn: inDays(-30), expiresOn: inDays(335) },
        recorderUserId,
      );
      expect(license.verifiedAt).toBeNull();
      expect(await prisma.auditLog.count({ where: { entityId: license.id, action: "counterparty_license.recorded" } })).toBe(1);
    });

    test("refuses a licence that has already expired, or was issued after it expires", async () => {
      const cp = await provider();
      const base = { kind: "other" as const, licenseNumber: "X-1", issuingAuthority: "Some Authority" };
      await expect(service.record(cp.id, { ...base, expiresOn: inDays(-1) }, recorderUserId)).rejects.toThrow(/expired/);
      await expect(service.record(cp.id, { ...base, issuedOn: inDays(20), expiresOn: inDays(10) }, recorderUserId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("two people", () => {
    test("whoever recorded a licence can't verify it; someone else can, once, and it's audited", async () => {
      const cp = await provider();
      const license = await service.record(
        cp.id,
        { kind: "data_protection_registration", licenseNumber: "NDPC-42", issuingAuthority: "NDPC", expiresOn: inDays(200) },
        recorderUserId,
      );
      await expect(service.verify(license.id, { note: "Checked it myself." }, recorderUserId)).rejects.toThrow(ForbiddenException);

      const verified = await service.verify(license.id, { note: "Confirmed on the NDPC register." }, verifierUserId);
      expect(verified.verifiedByUserId).toBe(verifierUserId);
      expect(await prisma.auditLog.count({ where: { entityId: license.id, action: "counterparty_license.verified" } })).toBe(1);
      await expect(service.verify(license.id, { note: "Again." }, verifierUserId)).rejects.toThrow(ConflictException);
    });

    test("the database itself refuses a verification by whoever recorded it", async () => {
      const cp = await provider();
      const license = await service.record(
        cp.id,
        { kind: "other", licenseNumber: "DB-1", issuingAuthority: "Some Authority", expiresOn: inDays(100) },
        recorderUserId,
      );
      await expect(
        prisma.counterpartyLicense.update({
          where: { id: license.id },
          data: { verifiedByUserId: recorderUserId, verifiedAt: new Date(), verificationNote: "Self-verified." },
        }),
      ).rejects.toThrow(/counterparty_licenses_verifier_not_recorder/);
    });
  });

  describe("history is kept", () => {
    test("the database refuses changing a recorded licence, or deleting one", async () => {
      const cp = await provider();
      const license = await recordAndVerify(cp.id, "health_facility_registration");
      await expect(prisma.counterpartyLicense.update({ where: { id: license.id }, data: { expiresOn: new Date("2099-01-01") } })).rejects.toThrow(
        /can't be changed/,
      );
      await expect(prisma.counterpartyLicense.update({ where: { id: license.id }, data: { verificationNote: "Edited." } })).rejects.toThrow(
        /verification can't be changed/,
      );
      await expect(prisma.counterpartyLicense.delete({ where: { id: license.id } })).rejects.toThrow(/never deleted/);
    });

    test("withdrawing is audited, can't be repeated, and a withdrawn licence can't then be verified", async () => {
      const cp = await provider();
      const license = await service.record(
        cp.id,
        { kind: "professional_indemnity_insurance", licenseNumber: "POL-77", issuingAuthority: "Fixture Insurance Plc", expiresOn: inDays(300) },
        recorderUserId,
      );
      await service.withdraw(license.id, { reason: "Recorded against the wrong policy." }, verifierUserId);
      expect(await prisma.auditLog.count({ where: { entityId: license.id, action: "counterparty_license.withdrawn" } })).toBe(1);
      await expect(service.withdraw(license.id, { reason: "Again." }, verifierUserId)).rejects.toThrow(ConflictException);
      await expect(service.verify(license.id, { note: "Too late." }, verifierUserId)).rejects.toThrow(/withdrawn/);
      await expect(
        prisma.counterpartyLicense.update({
          where: { id: license.id },
          data: { verifiedByUserId: verifierUserId, verifiedAt: new Date(), verificationNote: "Directly." },
        }),
      ).rejects.toThrow(/withdrawn licence can't be verified/);
    });
  });

  describe("payments wait for current licences", () => {
    test("other counterparty types have no required licences, so nothing changes for them", async () => {
      const bank = await prisma.counterparty.create({
        data: { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "NG", businessActivities: "Fixture bank for licence tests." },
      });
      expect(await licenseRequirements(prisma, bank)).toEqual([]);
      await expect(assertLicensesCurrent(prisma, bank.id)).resolves.toBeUndefined();
    });

    test("a healthcare provider is refused until every required licence is verified and in date", async () => {
      const cp = await provider();
      await expect(assertLicensesCurrent(prisma, cp.id)).rejects.toThrow(/none recorded/);

      const [first, ...rest] = required;
      await service.record(cp.id, { kind: first, licenseNumber: "FAC-1", issuingAuthority: "Oyo State Ministry of Health", expiresOn: inDays(90) }, recorderUserId);
      const statuses = await licenseRequirements(prisma, cp);
      expect(statuses.find((s) => s.kind === first)?.status).toBe("awaiting_verification");
      await expect(assertLicensesCurrent(prisma, cp.id)).rejects.toThrow(/not yet verified/);

      for (const kind of rest) await recordAndVerify(cp.id, kind);
      await expect(assertLicensesCurrent(prisma, cp.id)).rejects.toThrow(BadRequestException);
      await recordAndVerify(cp.id, first, inDays(90));
      await expect(assertLicensesCurrent(prisma, cp.id)).resolves.toBeUndefined();

      // In date all of its expiry day, refused the day after.
      await expect(assertLicensesCurrent(prisma, cp.id, inDays(90))).resolves.toBeUndefined();
      await expect(assertLicensesCurrent(prisma, cp.id, inDays(91))).rejects.toThrow(/expired/);
    });

    test("a verified renewal takes over from the old licence, and withdrawing the only current one stops payments", async () => {
      const cp = await provider();
      await fullyLicensed(cp.id, inDays(30));
      const renewal = await recordAndVerify(cp.id, "health_facility_registration", inDays(395));
      await expect(assertLicensesCurrent(prisma, cp.id, inDays(60))).rejects.toThrow(/expired/); // the others weren't renewed
      const statuses = await licenseRequirements(prisma, cp, inDays(60));
      expect(statuses.find((s) => s.kind === "health_facility_registration")).toEqual({
        kind: "health_facility_registration",
        status: "current",
        expiresOn: inDays(395),
      });

      await service.withdraw(renewal.id, { reason: "The Ministry suspended the facility licence." }, verifierUserId);
      await expect(assertLicensesCurrent(prisma, cp.id)).resolves.toBeUndefined(); // the original is still in date today
      const [original] = await prisma.counterpartyLicense.findMany({
        where: { counterpartyId: cp.id, kind: "health_facility_registration", withdrawnAt: null },
      });
      await service.withdraw(original.id, { reason: "Suspended along with the renewal." }, verifierUserId);
      await expect(assertLicensesCurrent(prisma, cp.id)).rejects.toThrow(/Health facility registration/);
    });

    test("onboarding a healthcare provider is refused without its licences, even with Shariah approval", async () => {
      const cp = await provider({ status: "pending_review", shariahApproved: true });
      await expect(prisma.$transaction((tx) => counterparties.onboard(cp.id, tx))).rejects.toThrow(/licences are in order/);
      await fullyLicensed(cp.id);
      const onboarded = await prisma.$transaction((tx) => counterparties.onboard(cp.id, tx));
      expect(onboarded.status).toBe("active");
    });
  });

  describe("expiry warnings", () => {
    test("each warning is due once: 60, 30 and 7 days before, then once it has lapsed", () => {
      expect(noticeDue(90, null)).toBeNull();
      expect(noticeDue(60, null)).toBe(60);
      expect(noticeDue(45, 60)).toBeNull();
      expect(noticeDue(30, 60)).toBe(30);
      expect(noticeDue(3, 60)).toBe(7);
      expect(noticeDue(0, 7)).toBeNull(); // still in date on its expiry day
      expect(noticeDue(-1, 7)).toBe(0);
      expect(noticeDue(-40, 0)).toBeNull();
    });

    test("warns whoever verifies licences, once per stage, and skips a licence already renewed", async () => {
      const cp = await provider();
      const expiring = await recordAndVerify(cp.id, "medical_laboratory_registration", inDays(20));
      const renewed = await recordAndVerify(cp.id, "data_protection_registration", inDays(5));
      await recordAndVerify(cp.id, "data_protection_registration", inDays(365));

      const notify = jest.fn().mockResolvedValue(undefined);
      await sendLicenseExpiryNotices({ notify } as any);
      const ours = notify.mock.calls.map(([n]) => n).filter((n) => n.relatedEntityId === expiring.id);
      expect(ours.length).toBeGreaterThan(0);
      expect(ours.map((n) => n.recipientUserId)).toContain(verifierUserId);
      expect(ours[0]).toMatchObject({ type: "counterparty_license.expiring", linkUrl: `/ops/counterparties/${cp.id}` });
      expect(notify.mock.calls.some(([n]) => n.relatedEntityId === renewed.id)).toBe(false);
      expect((await prisma.counterpartyLicense.findUniqueOrThrow({ where: { id: expiring.id } })).lastExpiryNoticeDays).toBe(30);

      notify.mockClear();
      await sendLicenseExpiryNotices({ notify } as any);
      expect(notify.mock.calls.some(([n]) => n.relatedEntityId === expiring.id)).toBe(false);
    });
  });
});
