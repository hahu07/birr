import { prisma } from "@birr/db";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ZakahFitrService } from "./zakah-fitr.service";
import { unusedFitrSeason } from "./test-support-fitr";

// Campaigns are never deleted, so fixtures stay in the shared dev
// database. They're dated June 2001 against a faked "today": once a real
// campaign exists it's always the one that matters, and a test campaign
// at most shows as long closed. (zakah-payments.service.spec.ts uses a
// January 2001 window, so the two never pick up each other's campaigns.)
describe("ZakahFitrService", () => {
  const service = new ZakahFitrService();
  let today = "2001-06-05";
  service.now = () => new Date(`${today}T12:00:00Z`);

  const nextSeason = unusedFitrSeason;
  const fields = { staple: "Rice", kgPerPerson: "2.5", amountPerPerson: "2500", opensOn: "2001-06-01", expectedEidOn: "2001-06-20" };

  let officerUserId: string;
  let shariahUserId: string;

  beforeAll(async () => {
    const run = Date.now().toString(36);
    const officer = await prisma.user.create({ data: { email: `fitr-officer-${run}@example.com`, fullName: "Test Fitr Officer" } });
    officerUserId = officer.id;
    await prisma.birrStaff.create({ data: { userId: officer.id, roles: { create: { role: "mutawalli_officer" } } } });
    const shariah = await prisma.user.create({ data: { email: `fitr-shariah-${run}@example.com`, fullName: "Test Fitr Shariah" } });
    shariahUserId = shariah.id;
    await prisma.birrStaff.create({ data: { userId: shariah.id, roles: { create: { role: "shariah_board_member" } } } });
  });

  beforeEach(() => {
    today = "2001-06-05";
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function approve(campaignId: string) {
    const c = await prisma.zakahFitrCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    const payload = {
      campaignId,
      staple: c.staple,
      kgPerPerson: c.kgPerPerson.toFixed(),
      amountPerPerson: c.amountPerPerson.toFixed(),
      opensOn: c.opensOn.toISOString().slice(0, 10),
      expectedEidOn: c.expectedEidOn.toISOString().slice(0, 10),
    };
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "zakah.fitr_campaign_approve" } });
    const action = await prisma.governedAction.create({
      data: { permissionId: permission.id, makerType: "human", makerUserId: officerUserId, checkerUserId: shariahUserId, status: "approved", decidedAt: new Date(), payload },
    });
    return prisma.$transaction((tx) => service.approve(payload, action.id, shariahUserId, tx));
  }

  test("a draft closes payments the day before Eid, and is audited", async () => {
    const draft = await service.createDraft({ season: await nextSeason(), ...fields }, officerUserId);
    expect(draft).toMatchObject({ version: 1, status: "draft", staple: "Rice" });
    expect(draft.closesOn.toISOString().slice(0, 10)).toBe("2001-06-19");
    expect(await prisma.auditLog.count({ where: { entityId: draft.id, action: "zakah_fitr_campaign.drafted" } })).toBe(1);
  });

  test("refuses a second draft for the same season, and payments that would open after they close", async () => {
    const season = await nextSeason();
    await service.createDraft({ season, ...fields }, officerUserId);
    await expect(service.createDraft({ season, ...fields }, officerUserId)).rejects.toThrow(ConflictException);
    await expect(service.createDraft({ season: await nextSeason(), ...fields, opensOn: "2001-06-20" }, officerUserId)).rejects.toThrow(
      BadRequestException,
    );
  });

  test("approving a new version supersedes the old, and is what the public sees", async () => {
    const season = await nextSeason();
    const v1 = await service.createDraft({ season, ...fields }, officerUserId);
    await approve(v1.id);
    // The moon sighting moves Eid a day later: a revised version.
    const v2 = await service.createDraft({ season, ...fields, expectedEidOn: "2001-06-21" }, officerUserId);
    const { after } = await approve(v2.id);

    expect(after).toMatchObject({ status: "approved", version: 2 });
    expect((await prisma.zakahFitrCampaign.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("superseded");
    expect(await prisma.auditLog.count({ where: { entityId: v1.id, action: "zakah_fitr_campaign.superseded" } })).toBe(1);

    // On the 20th only the revised version (closing that day) is still
    // open — other fixtures close on the 19th — and ties go to the most
    // recently approved, so this is deterministic across runs.
    today = "2001-06-20";
    const current = await service.currentPublic();
    expect(current).toMatchObject({ season, staple: "Rice", amountPerPerson: "2500.00", closesOn: "2001-06-20", state: "open" });
  });

  test("approval refuses a draft that changed since it was proposed", async () => {
    const draft = await service.createDraft({ season: await nextSeason(), ...fields }, officerUserId);
    await expect(service.validateApprovalProposal({ campaignId: draft.id, ...fields, amountPerPerson: "2000" })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.validateApprovalProposal({ campaignId: draft.id, ...fields })).resolves.toBeUndefined();
  });

  test("is upcoming before it opens, open until the day before Eid, then closed", async () => {
    const c = await approve((await service.createDraft({ season: await nextSeason(), ...fields }, officerUserId)).id);
    today = "2001-05-31";
    expect(service.stateOf(c.after)).toBe("upcoming");
    today = "2001-06-19";
    expect(service.stateOf(c.after)).toBe("open");
    today = "2001-06-20";
    expect(service.stateOf(c.after)).toBe("closed");
  });

  test("a finished campaign is shown for a month after Eid, then there's no current campaign", async () => {
    // A window of its own (December 2001), well clear of the other fixtures.
    const decFields = { ...fields, opensOn: "2001-12-01", expectedEidOn: "2001-12-15" };
    await approve((await service.createDraft({ season: await nextSeason(), ...decFields }, officerUserId)).id);
    // A real, later season in this shared database is (correctly) always
    // the current one, which leaves nothing here to check.
    const later = await prisma.zakahFitrCampaign.count({ where: { status: "approved", closesOn: { gte: new Date("2002-01-10") } } });
    if (later > 0) return;
    today = "2002-01-10";
    expect(await service.current()).toMatchObject({ state: "closed", campaign: { expectedEidOn: new Date("2001-12-15") } });
    today = "2002-01-20";
    expect(await service.current()).toBeNull();
  });

  test("staff can close payments early, once, and it's audited", async () => {
    const { after } = await approve((await service.createDraft({ season: await nextSeason(), ...fields }, officerUserId)).id);
    const closed = await service.close(after.id, officerUserId);
    expect(service.stateOf(closed)).toBe("closed");
    expect(await prisma.auditLog.count({ where: { entityId: after.id, action: "zakah_fitr_campaign.closed" } })).toBe(1);
    await expect(service.close(after.id, officerUserId)).rejects.toThrow(ConflictException);
  });

  // Straight to the database: it enforces these itself.
  test("an approved campaign can't be edited or reopened, nothing is deleted, and it always closes the day before Eid", async () => {
    const { after } = await approve((await service.createDraft({ season: await nextSeason(), ...fields }, officerUserId)).id);
    await expect(prisma.zakahFitrCampaign.update({ where: { id: after.id }, data: { amountPerPerson: "100" } })).rejects.toThrow(/can't be edited/);
    await prisma.zakahFitrCampaign.update({ where: { id: after.id }, data: { closedAt: new Date() } });
    await expect(prisma.zakahFitrCampaign.update({ where: { id: after.id }, data: { closedAt: null } })).rejects.toThrow(/can't be edited/);
    await expect(prisma.zakahFitrCampaign.delete({ where: { id: after.id } })).rejects.toThrow(/never deleted/);
    await expect(
      prisma.zakahFitrCampaign.create({
        data: {
          season: await nextSeason(), version: 1, staple: "Rice", kgPerPerson: "2.5", amountPerPerson: "2500",
          opensOn: new Date("2001-06-01"), expectedEidOn: new Date("2001-06-20"), closesOn: new Date("2001-06-20"), createdByUserId: officerUserId,
        },
      }),
    ).rejects.toThrow();
  });
});
