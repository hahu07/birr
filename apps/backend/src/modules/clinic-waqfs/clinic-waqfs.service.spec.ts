import { prisma } from "@birr/db";
import { ConflictException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClinicWaqfsService } from "./clinic-waqfs.service";
import { ClinicLedgerService } from "./clinic-ledger.service";
import { deedTextHash } from "./clinic-waqf-deed";

// Fixtures stay behind: clinic waqfs, their deeds and their ledger are
// never deleted (triggers), like audit_logs. Approving and establishing go
// through the governed-action engine: governed-actions.service.spec.ts.
describe("ClinicWaqfsService", () => {
  const service = new ClinicWaqfsService();
  const ledger = new ClinicLedgerService();
  let actorUserId: string;

  const slug = () => `test-clinic-${randomUUID().slice(0, 8)}`;
  const newClinic = () => service.create({ name: "Test Mother & Child Clinic", slug: slug(), city: "Ibadan", jurisdiction: "NG" }, actorUserId);

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `clinic-waqfs-${randomUUID()}@example.com`, fullName: "Clinic Officer" } });
    await prisma.birrStaff.create({ data: { userId: user.id, roles: { create: { role: "mutawalli_officer" } } } });
    actorUserId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("the clinic waqf", () => {
    test("starts as a draft and is audited; an address is used once", async () => {
      const clinic = await newClinic();
      expect(clinic.status).toBe("draft");
      expect(await prisma.auditLog.count({ where: { entityId: clinic.id, action: "clinic_waqf.created" } })).toBe(1);
      await expect(
        service.create({ name: "Another", slug: clinic.slug, city: "Ibadan", jurisdiction: "NG" }, actorUserId),
      ).rejects.toThrow(ConflictException);
    });

    test("the database refuses a malformed address, changing it, establishing without an approval, or deleting", async () => {
      await expect(
        prisma.waqfProgramme.create({ data: { product: "clinic", name: "Bad", slug: "Bad Slug", city: "Ibadan", jurisdiction: "NG", createdByUserId: actorUserId } }),
      ).rejects.toThrow(/waqf_programmes_slug_format/);
      const clinic = await newClinic();
      await expect(prisma.waqfProgramme.update({ where: { id: clinic.id }, data: { slug: slug() } })).rejects.toThrow(/never changes/);
      await expect(
        prisma.waqfProgramme.update({ where: { id: clinic.id }, data: { status: "established", establishedAt: new Date() } }),
      ).rejects.toThrow(/waqf_programmes_establishment_consistent/);
      await expect(prisma.waqfProgramme.delete({ where: { id: clinic.id } })).rejects.toThrow(/never deleted/);
    });
  });

  describe("the deed", () => {
    test("a first draft uses the standard wording for this clinic, hashed, and is audited", async () => {
      const clinic = await newClinic();
      const deed = await service.draftDeed(clinic.id, {}, actorUserId);
      expect(deed).toMatchObject({ version: 1, status: "draft", textHash: deedTextHash(deed.text) });
      expect(deed.text).toContain("Test Mother & Child Clinic");
      expect(deed.text).toContain("Ibadan");
      expect(await prisma.auditLog.count({ where: { entityId: deed.id, action: "clinic_waqf_deed.drafted" } })).toBe(1);
    });

    test("one open draft at a time; discarding it allows the next version", async () => {
      const clinic = await newClinic();
      const first = await service.draftDeed(clinic.id, { text: "Version one wording." }, actorUserId);
      await expect(service.draftDeed(clinic.id, { text: "Another draft." }, actorUserId)).rejects.toThrow(ConflictException);
      await service.discardDeed(clinic.id, first.id, actorUserId);
      expect(await prisma.auditLog.count({ where: { entityId: first.id, action: "clinic_waqf_deed.discarded" } })).toBe(1);
      const second = await service.draftDeed(clinic.id, { text: "Version two wording." }, actorUserId);
      expect(second.version).toBe(2);
    });

    test("the database checks the hash against the text, and refuses rewording a version or deleting it", async () => {
      const clinic = await newClinic();
      await expect(
        prisma.waqfProgrammeDeed.create({
          data: { programmeId: clinic.id, version: 1, text: "Real wording.", textHash: deedTextHash("Other wording."), createdByUserId: actorUserId },
        }),
      ).rejects.toThrow(/waqf_programme_deeds_hash_matches/);
      const deed = await service.draftDeed(clinic.id, { text: "Real wording." }, actorUserId);
      await expect(
        prisma.waqfProgrammeDeed.update({ where: { id: deed.id }, data: { text: "Changed.", textHash: deedTextHash("Changed.") } }),
      ).rejects.toThrow(/wording never changes/);
      await expect(prisma.waqfProgrammeDeed.update({ where: { id: deed.id }, data: { status: "superseded" } })).rejects.toThrow(/can't go from draft/);
      await expect(prisma.waqfProgrammeDeed.delete({ where: { id: deed.id } })).rejects.toThrow(/never deleted/);
    });

    test("establishing needs an approved deed", async () => {
      const clinic = await newClinic();
      await service.draftDeed(clinic.id, {}, actorUserId);
      await expect(service.validateEstablishProposal({ programmeId: clinic.id })).rejects.toThrow(/no approved deed/);
    });

    test("a deed proposal must name the wording's hash", async () => {
      const clinic = await newClinic();
      const deed = await service.draftDeed(clinic.id, { text: "Wording to approve." }, actorUserId);
      await expect(service.validateDeedProposal({ deedId: deed.id, textHash: deedTextHash("Something else.") })).rejects.toThrow(/changed/);
      await expect(service.validateDeedProposal({ deedId: deed.id, textHash: deed.textHash })).resolves.toBeUndefined();
    });
  });

  describe("the ledger keeps the two pots apart", () => {
    test("an entry balanced within each pot posts, and balances show per pot", async () => {
      const clinic = await newClinic();
      await prisma.$transaction(async (tx) => {
        await ledger.post(tx, {
          programmeId: clinic.id,
          description: "Test gifts: one endowed, one to spend",
          currency: "NGN",
          source: "manual_adjustment",
          actorType: "birr_staff",
          actorUserId,
          lines: [
            { accountCode: "1000", debit: "250000" },
            { accountCode: "3000", credit: "250000" },
            { accountCode: "1100", debit: "5000" },
            { accountCode: "4000", credit: "5000" },
          ],
        });
      });
      const balances = await ledger.balances(clinic.id);
      expect(balances.endowment.find((a) => a.code === "1000")?.balance).toBe("250000.00");
      expect(balances.running.find((a) => a.code === "1100")?.balance).toBe("5000.00");
    });

    test("moving money from the endowment to the running fund is refused, by the service and by the database", async () => {
      const clinic = await newClinic();
      const crossing = {
        programmeId: clinic.id,
        description: "Spend endowment cash",
        currency: "NGN",
        source: "manual_adjustment" as const,
        actorType: "birr_staff" as const,
        actorUserId,
        lines: [
          { accountCode: "1100", debit: "1000" },
          { accountCode: "1000", credit: "1000" },
        ],
      };
      await expect(prisma.$transaction((tx) => ledger.post(tx, crossing))).rejects.toThrow(/never mix/);

      // Straight to the database, past the service's own check.
      const [endowmentCash, runningCash] = await Promise.all([
        prisma.programmeLedgerAccount.findUniqueOrThrow({ where: { code: "1000" } }),
        prisma.programmeLedgerAccount.findUniqueOrThrow({ where: { code: "1100" } }),
      ]);
      await expect(
        prisma.programmeJournalEntry.create({
          data: {
            programmeId: clinic.id,
            description: "Spend endowment cash, directly",
            currency: "NGN",
            source: "manual_adjustment",
            actorType: "birr_staff",
            lines: {
              create: [
                { ledgerAccountId: runningCash.id, debit: 1000 },
                { ledgerAccountId: endowmentCash.id, credit: 1000 },
              ],
            },
          },
        }),
      ).rejects.toThrow(/never mix/);
    });

    test("the ledger is append-only, and an account's pot never changes", async () => {
      const clinic = await newClinic();
      const entry = await prisma.$transaction((tx) =>
        ledger.post(tx, {
          programmeId: clinic.id,
          description: "Endowed gift",
          currency: "NGN",
          source: "manual_adjustment",
          actorType: "birr_staff",
          actorUserId,
          lines: [
            { accountCode: "1000", debit: "100" },
            { accountCode: "3000", credit: "100" },
          ],
        }),
      );
      await expect(prisma.programmeJournalEntry.update({ where: { id: entry.id }, data: { description: "Edited" } })).rejects.toThrow(/append-only/);
      await expect(prisma.programmeJournalEntryLine.delete({ where: { id: entry.lines[0].id } })).rejects.toThrow(/append-only/);
      await expect(prisma.programmeLedgerAccount.update({ where: { code: "1000" }, data: { pot: "running" } })).rejects.toThrow(/never change/);
    });
  });
});
