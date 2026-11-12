import { prisma, Prisma } from "@birr/db";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { calculateZakah, draftRulesets, priceFreshness } from "@birr/zakah";
import { lagosToday, ZakahService } from "./zakah.service";

// Shared dev database, and both zakah tables are append-only by design
// (nothing here can be cleaned up afterwards), so fixtures are chosen to
// be harmless if left behind:
// - rulesets use a per-run key ("test-<run>-…"), never a real one;
// - prices are dated January 2001 against a faked "today", so they can
//   never be the current prices once real ones exist, and are far too old
//   for the calculator to use if they're all there is.
describe("ZakahService", () => {
  const service = new ZakahService();
  service.now = () => new Date("2001-01-15T12:00:00Z");

  const run = Date.now().toString(36);
  const key = (name: string) => `test-${run}-${name}`;
  const maliki = draftRulesets.maliki.rulings;

  let officerUserId: string;
  let shariahUserId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff are not cleaned up — same reasoning as every
    // other spec here (audit_logs references them, and it's insert-only).
    const officer = await prisma.user.create({ data: { email: `zakah-officer-${run}@example.com`, fullName: "Test Zakah Officer" } });
    officerUserId = officer.id;
    await prisma.birrStaff.create({ data: { userId: officer.id, roles: { create: { role: "mutawalli_officer" } } } });
    const shariah = await prisma.user.create({ data: { email: `zakah-shariah-${run}@example.com`, fullName: "Test Zakah Shariah" } });
    shariahUserId = shariah.id;
    await prisma.birrStaff.create({ data: { userId: shariah.id, roles: { create: { role: "shariah_board_member" } } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A governed action row for a zakah row to reference, as decide() would leave it. */
  async function governedAction(permissionKey: string, status: "proposed" | "approved", payload: object) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
    return prisma.governedAction.create({
      data: {
        permissionId: permission.id,
        makerType: "human",
        makerUserId: officerUserId,
        checkerUserId: status === "approved" ? shariahUserId : null,
        status,
        decidedAt: status === "approved" ? new Date() : null,
        payload,
      },
    });
  }

  async function approve(rulesetId: string) {
    const draft = await prisma.zakahRuleset.findUniqueOrThrow({ where: { id: rulesetId } });
    const payload = { rulesetId, label: draft.label, rulings: draft.rulings };
    const action = await governedAction("zakah.ruleset_approve", "approved", payload);
    return prisma.$transaction((tx) => service.approveRuleset(payload, action.id, shariahUserId, tx));
  }

  describe("drafting a ruleset", () => {
    test("createDraft() starts at version 1 and writes a zakah_ruleset.drafted audit log", async () => {
      const draft = await service.createDraft({ key: key("draft"), madhhab: "maliki", label: "Maliki ", rulings: maliki }, officerUserId);

      expect(draft).toMatchObject({ version: 1, status: "draft", label: "Maliki", createdByUserId: officerUserId });
      const logs = await prisma.auditLog.findMany({ where: { entityId: draft.id, action: "zakah_ruleset.drafted" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId: officerUserId, before: null });
    });

    test("createDraft() stores only the known rulings fields", async () => {
      const draft = await service.createDraft(
        { key: key("extra"), madhhab: "maliki", label: "Maliki", rulings: { ...maliki, note: "ignored" } },
        officerUserId,
      );
      expect(draft.rulings).toEqual(maliki);
    });

    test("createDraft() refuses a second draft for the same key", async () => {
      const input = { key: key("twice"), madhhab: "maliki" as const, label: "Maliki", rulings: maliki };
      await service.createDraft(input, officerUserId);
      await expect(service.createDraft(input, officerUserId)).rejects.toThrow(ConflictException);
    });

    test("createDraft() refuses invalid rulings", async () => {
      await expect(
        service.createDraft({ key: key("bad"), madhhab: "maliki", label: "Maliki", rulings: { ...maliki, debts: "sometimes" } }, officerUserId),
      ).rejects.toThrow(BadRequestException);
    });

    test("updateDraft() writes a zakah_ruleset.draft_updated audit log with a before snapshot", async () => {
      const draft = await service.createDraft({ key: key("edit"), madhhab: "hanafi", label: "Hanafi", rulings: maliki }, officerUserId);
      const hanafi = draftRulesets.hanafi.rulings;
      const updated = await service.updateDraft(draft.id, { label: "Hanafi", rulings: hanafi }, officerUserId);

      expect(updated.rulings).toEqual(hanafi);
      const logs = await prisma.auditLog.findMany({ where: { entityId: draft.id, action: "zakah_ruleset.draft_updated" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].before).toMatchObject({ rulings: maliki });
    });

    test("updateDraft() is refused while the draft waits for Shariah approval", async () => {
      const draft = await service.createDraft({ key: key("pending"), madhhab: "maliki", label: "Maliki", rulings: maliki }, officerUserId);
      await governedAction("zakah.ruleset_approve", "proposed", { rulesetId: draft.id, label: draft.label, rulings: maliki });

      await expect(service.updateDraft(draft.id, { label: "Changed", rulings: maliki }, officerUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("approving a ruleset", () => {
    test("approveRuleset() makes the draft live and supersedes the previous version, auditing it", async () => {
      const k = key("versions");
      const v1 = await service.createDraft({ key: k, madhhab: "maliki", label: "Maliki", rulings: maliki }, officerUserId);
      await approve(v1.id);
      const v2 = await service.createDraft(
        { key: k, madhhab: "maliki", label: "Maliki", rulings: { ...maliki, nisabBasis: "silver" } },
        officerUserId,
      );
      expect(v2.version).toBe(2);

      const { before, after } = await approve(v2.id);
      expect(before.status).toBe("draft");
      expect(after).toMatchObject({ status: "approved", version: 2 });
      expect(after.approvedGovernedActionId).toEqual(expect.any(String));

      const v1Now = await prisma.zakahRuleset.findUniqueOrThrow({ where: { id: v1.id } });
      expect(v1Now.status).toBe("superseded");
      const logs = await prisma.auditLog.findMany({ where: { entityId: v1.id, action: "zakah_ruleset.superseded" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorUserId).toBe(shariahUserId);

      const live = (await service.listCurrentRulesets()).filter((r) => r.id === k);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ version: 2, approval: { status: "approved" } });
    });

    test("approveRuleset() refuses when the draft differs from what was proposed", async () => {
      const draft = await service.createDraft({ key: key("stale"), madhhab: "maliki", label: "Maliki", rulings: maliki }, officerUserId);
      const stale = { rulesetId: draft.id, label: draft.label, rulings: { ...maliki, debts: "none" } };
      const action = await governedAction("zakah.ruleset_approve", "approved", stale);

      await expect(prisma.$transaction((tx) => service.approveRuleset(stale, action.id, shariahUserId, tx))).rejects.toThrow(
        ConflictException,
      );
      expect((await prisma.zakahRuleset.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft");
    });

    test("an approved ruleset from the API can be used by the calculator without opting into drafts", async () => {
      const k = key("calc");
      const draft = await service.createDraft(
        { key: k, madhhab: "maliki", label: "Maliki", rulings: { ...maliki, nisabBasis: "silver" } },
        officerUserId,
      );
      await approve(draft.id);
      const ruleset = (await service.listCurrentRulesets()).find((r) => r.id === k)!;

      const result = calculateZakah(
        { cash: "3000000", tradeGoods: "1200000", receivables: "0", metals: [], debtsDueNow: "400000" },
        ruleset,
        { goldPerGram: "150000", silverPerGram: "2000", asOf: "2001-01-10", source: "test" },
        { today: "2001-01-15" },
      );
      expect(result.zakahDue).toBe("95000.00");
      expect(result.ruleset).toMatchObject({ id: k, version: 1, status: "approved" });
    });
  });

  // Bypasses ZakahService entirely: these prove the database itself
  // enforces the rules, not just the application code.
  describe("database rules for rulesets", () => {
    let approvedId: string;
    let draftId: string;

    beforeAll(async () => {
      const k = key("db");
      const v1 = await service.createDraft({ key: k, madhhab: "maliki", label: "Maliki", rulings: maliki }, officerUserId);
      await approve(v1.id);
      approvedId = v1.id;
      draftId = (await service.createDraft({ key: k, madhhab: "maliki", label: "Maliki", rulings: maliki }, officerUserId)).id;
    });

    test("an approved ruleset's rulings can't be edited", async () => {
      await expect(
        prisma.zakahRuleset.update({ where: { id: approvedId }, data: { rulings: { ...maliki, debts: "none" } } }),
      ).rejects.toThrow(/can't be edited/);
    });

    test("an approved ruleset can't go back to draft", async () => {
      await expect(
        prisma.zakahRuleset.update({
          where: { id: approvedId },
          data: { status: "draft", approvedAt: null, approvedGovernedActionId: null },
        }),
      ).rejects.toThrow();
    });

    test("no ruleset can be deleted, draft or approved", async () => {
      await expect(prisma.zakahRuleset.delete({ where: { id: draftId } })).rejects.toThrow(/never deleted/);
      await expect(prisma.zakahRuleset.delete({ where: { id: approvedId } })).rejects.toThrow(/never deleted/);
    });

    test("a draft's key and version can't change", async () => {
      await expect(prisma.zakahRuleset.update({ where: { id: draftId }, data: { key: key("renamed") } })).rejects.toThrow(
        /never change/,
      );
      await expect(prisma.zakahRuleset.update({ where: { id: draftId }, data: { version: 99 } })).rejects.toThrow(/never change/);
    });

    test("a draft can't be marked approved without approval details", async () => {
      await expect(prisma.zakahRuleset.update({ where: { id: draftId }, data: { status: "approved" } })).rejects.toThrow();
    });

    test("only one version per key can be approved at once", async () => {
      const action = await governedAction("zakah.ruleset_approve", "approved", { rulesetId: draftId });
      await expect(
        prisma.zakahRuleset.update({
          where: { id: draftId },
          data: { status: "approved", approvedAt: new Date(), approvedGovernedActionId: action.id },
        }),
      ).rejects.toThrow();
    });
  });

  describe("metal prices", () => {
    const valid = { goldPerGram: "150000", silverPerGram: "2000", asOf: "2001-01-10", source: " Test fixture " };

    test("validateMetalPriceProposal() accepts a valid proposal and trims the source", () => {
      expect(service.validateMetalPriceProposal(valid)).toEqual({ ...valid, source: "Test fixture" });
    });

    test.each([
      ["a future date", { asOf: "2001-01-16" }, /future/],
      ["a date the calculator couldn't use", { asOf: "2000-12-14" }, /31 days/],
      ["a malformed date", { asOf: "10/01/2001" }, /asOf/],
      ["a zero price", { goldPerGram: "0" }, /goldPerGram/],
      ["a number instead of a string", { silverPerGram: 2000 }, /silverPerGram/],
      ["an absurd price", { goldPerGram: "150000000000" }, /goldPerGram/],
      ["no source", { source: "  " }, /source/],
    ])("validateMetalPriceProposal() rejects %s", (_label, override, message) => {
      expect(() => service.validateMetalPriceProposal({ ...valid, ...override })).toThrow(message);
    });

    test("recordMetalPrice() stores the approved price against its governed action", async () => {
      const action = await governedAction("zakah.metal_price_set", "approved", valid);
      const price = await prisma.$transaction((tx) => service.recordMetalPrice(valid, action.id, tx));

      expect(price).toMatchObject({ governedActionId: action.id, source: "Test fixture" });
      expect(price.goldPerGram.toFixed()).toBe("150000");
      expect(price.asOf.toISOString().slice(0, 10)).toBe("2001-01-10");
    });

    test("prices can't be edited or deleted, and must be positive", async () => {
      const action = await governedAction("zakah.metal_price_set", "approved", valid);
      const price = await prisma.$transaction((tx) => service.recordMetalPrice(valid, action.id, tx));

      await expect(prisma.zakahMetalPrice.update({ where: { id: price.id }, data: { source: "edited" } })).rejects.toThrow(
        /append-only/,
      );
      await expect(prisma.zakahMetalPrice.delete({ where: { id: price.id } })).rejects.toThrow(/append-only/);

      const zero = await governedAction("zakah.metal_price_set", "approved", valid);
      await expect(
        prisma.zakahMetalPrice.create({
          data: { goldPerGram: new Prisma.Decimal(0), silverPerGram: "2000", asOf: new Date("2001-01-10"), source: "x", governedActionId: zero.id },
        }),
      ).rejects.toThrow();
    });

    test("currentMetalPrices() reports plain decimal strings and their age today", async () => {
      const current = await service.currentMetalPrices();
      expect(current.goldPerGram).toMatch(/^\d+(\.\d+)?$/);
      expect(current.freshness).toEqual(priceFreshness(current.asOf, "2001-01-15"));
    });

    test("describeMetalPriceProposal() warns the checker when a price is dated before the current one", async () => {
      const text = await service.describeMetalPriceProposal({ ...valid, asOf: "2000-12-20" });
      expect(text).toMatch(/as of 2000-12-20/);
      expect(text).toMatch(/never used/);
    });
  });

  test("lagosToday() gives the date in Nigeria, an hour ahead of UTC", () => {
    expect(lagosToday(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-11");
    expect(lagosToday(new Date("2026-11-11T22:59:00Z"))).toBe("2026-11-11");
  });
});
