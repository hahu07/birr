import { prisma, Prisma } from "@birr/db";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { WaqfCausesService } from "./waqf-causes.service";
import { WaqfProceedsService } from "../waqf-proceeds/waqf-proceeds.service";
import { DistributionsService } from "../distributions/distributions.service";
import { BeneficiariesService } from "../beneficiaries/beneficiaries.service";
import { EncryptionService } from "../../common/settings/encryption.service";
import { WaqfLedgerService } from "../waqf-ledger/waqf-ledger.service";
import { createFakeNotificationsService } from "../notifications/test-support/fake-notifications-service";
import {
  FakePaystackPayoutAdapter,
  createFakeStablecoinPayoutAdapter,
  createFakeStripePayoutAdapter,
} from "../distributions/test-support/fake-payout-adapters";

// Owner's decisions, 2026-11-16: changing an existing cause allocation
// is guided. On an Asset or Project fund an allocation can't go below
// what's committed to the cause; a removed cause's committed money stays
// held back; lowering, moving or removing an allocation needs a reason
// and tells the fund's Mutawalli Officer.
describe("Guided cause allocation", () => {
  const service = new WaqfCausesService(undefined as unknown as WaqfProceedsService, createFakeNotificationsService());
  const distributions = new DistributionsService(
    new BeneficiariesService(new EncryptionService()),
    createFakeNotificationsService(),
    new WaqfLedgerService(),
    createFakeStripePayoutAdapter() as any,
    new FakePaystackPayoutAdapter() as any,
    createFakeStablecoinPayoutAdapter() as any,
  );
  const run = Date.now().toString(36);

  const categoryIds: string[] = [];
  const causeIds: string[] = [];
  const waqfIds: string[] = [];
  const beneficiaryIds: string[] = [];
  let founderId: string;
  let otherFounderId: string;
  let officerUserId: string;
  let otherWaqfCauseId: string;

  async function category(label: string) {
    const c = await prisma.causeCategory.create({ data: { name: `Guided ${label} ${randomUUID()}`, typicalWaqfTypes: [] } });
    categoryIds.push(c.id);
    return c;
  }

  async function fund(type: "asset" | "project" | "investment", raised: string, foundationId: string) {
    const waqf = await prisma.waqf.create({
      data: { name: `Guided ${type} fund ${run}`, type, jurisdiction: "NG", foundationId, corpusCurrency: "NGN" },
    });
    waqfIds.push(waqf.id);
    await prisma.contribution.create({
      data: { waqfId: waqf.id, amount: raised, currency: "NGN", provider: "paystack", providerReference: `guided-${randomUUID()}`, status: "confirmed" },
    });
    return waqf;
  }

  async function cause(waqfId: string, allocated: string | null, label = "cause") {
    const c = await category(label);
    const row = await prisma.waqfCause.create({ data: { waqfId, causeCategoryId: c.id, name: c.name, allocatedAmount: allocated } });
    causeIds.push(row.id);
    return row;
  }

  async function beneficiary(waqfId: string) {
    const b = await prisma.beneficiary.create({ data: { waqfId, name: "Guided Beneficiary", eligibilityCriteria: "Test" } });
    beneficiaryIds.push(b.id);
    return b;
  }

  /** A distribution straight to the database, already in the given status. */
  async function distribution(waqfId: string, causeId: string, amount: string, status: "pending" | "paid" | "rejected") {
    const b = await beneficiary(waqfId);
    return prisma.distribution.create({ data: { waqfId, causeId, beneficiaryId: b.id, amount, currency: "NGN", status } });
  }

  const allocatedOf = async (id: string) => (await prisma.waqfCause.findUniqueOrThrow({ where: { id } })).allocatedAmount?.toString();

  let foundationId: string;

  beforeAll(async () => {
    founderId = (await prisma.founder.create({ data: { name: `Guided Founder ${run}`, kind: "institution" } })).id;
    otherFounderId = (await prisma.founder.create({ data: { name: `Guided Other Founder ${run}`, kind: "institution" } })).id;
    foundationId = (await prisma.foundation.create({ data: { name: `Guided Foundation ${run}` } })).id;
    await prisma.foundationFounder.create({ data: { foundationId, founderId } });
    const otherFoundation = await prisma.foundation.create({ data: { name: `Guided Other Foundation ${run}` } });
    await prisma.foundationFounder.create({ data: { foundationId: otherFoundation.id, founderId: otherFounderId } });
    const otherWaqf = await fund("asset", "1000", otherFoundation.id);
    otherWaqfCauseId = (await cause(otherWaqf.id, "100", "other founder's")).id;

    const officer = await prisma.user.create({ data: { email: `guided-officer-${run}@example.com`, fullName: "Guided Officer" } });
    officerUserId = officer.id;
    await prisma.birrStaff.create({ data: { userId: officer.id, roles: { create: { role: "mutawalli_officer" } } } });
  });

  afterAll(async () => {
    await prisma.distribution.deleteMany({ where: { causeId: { in: causeIds } } });
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    // Funds with no assigned officer notify every active Mutawalli Officer
    // in the shared database; remove all of this spec's notices.
    await prisma.notification.deleteMany({
      where: { type: "waqf_cause.allocation_changed", linkUrl: { in: waqfIds.map((id) => `/ops/waqfs/${id}`) } },
    });
    await prisma.waqfCaseAssignment.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqfCause.deleteMany({ where: { id: { in: causeIds } } });
    await prisma.contribution.deleteMany({ where: { waqfId: { in: waqfIds } } });
    await prisma.waqf.deleteMany({ where: { id: { in: waqfIds } } });
    await prisma.causeCategory.deleteMany({ where: { id: { in: categoryIds } } });
    // The officer's staff record stays suspended rather than deleted: the
    // audit log may name them.
    await prisma.birrStaff.updateMany({ where: { userId: officerUserId }, data: { status: "suspended" } });
    await prisma.$disconnect();
  });

  describe("the floor: an allocation can't go below what's committed", () => {
    test("on an Asset fund, lowering below committed is refused, and lowering to exactly committed works", async () => {
      const waqf = await fund("asset", "1000", foundationId);
      const c = await cause(waqf.id, "500");
      await distribution(waqf.id, c.id, "200", "paid");
      await distribution(waqf.id, c.id, "100", "pending");
      // Rejected distributions hold nothing.
      await distribution(waqf.id, c.id, "150", "rejected");

      await expect(service.allocate(c.id, founderId, "299.99", "Moving funds to education.")).rejects.toThrow(/₦300.00 has already been committed/);
      await service.allocate(c.id, founderId, "300", "Moving funds to education.");
      expect(await allocatedOf(c.id)).toBe("300");
    });

    test("on an Investment fund, where corpus isn't what's spent, there's no floor", async () => {
      const waqf = await fund("investment", "1000", foundationId);
      const c = await cause(waqf.id, "500");
      await distribution(waqf.id, c.id, "400", "paid");
      await service.allocate(c.id, founderId, "100", "Rebalancing the corpus target.");
      expect(await allocatedOf(c.id)).toBe("100");
    });
  });

  describe("reasons", () => {
    test("lowering needs a reason, kept in the audit row; raising or a first allocation doesn't", async () => {
      const waqf = await fund("project", "1000", foundationId);
      const c = await cause(waqf.id, null);
      await service.allocate(c.id, founderId, "400");
      await service.allocate(c.id, founderId, "600");
      await expect(service.allocate(c.id, founderId, "500")).rejects.toThrow(/Please say why you're lowering/);
      await expect(service.allocate(c.id, founderId, "500", "  no  ")).rejects.toThrow(BadRequestException);
      await service.allocate(c.id, founderId, "500", "  The school build came in under budget.  ");

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: c.id, action: "waqf_cause.allocation_set" },
        orderBy: { createdAt: "desc" },
      });
      expect(log.after).toMatchObject({ changeReason: "The school build came in under budget." });
      expect(log.actorFounderId).toBe(founderId);
    });
  });

  describe("moving an allocation between causes", () => {
    test("moves in one step: the fund's total is unchanged and each cause gets an audit row with the reason", async () => {
      const waqf = await fund("asset", "1000", foundationId);
      const from = await cause(waqf.id, "600", "from");
      const to = await cause(waqf.id, "200", "to");
      await distribution(waqf.id, from.id, "250", "paid");

      await expect(service.moveAllocation(from.id, founderId, { toCauseId: to.id, amount: "350.01", reason: "Shift to water." })).rejects.toThrow(
        /Only ₦350.00 can be moved/,
      );
      await expect(service.moveAllocation(from.id, founderId, { toCauseId: to.id, amount: "100" })).rejects.toThrow(/Please say why you're moving/);
      await expect(service.moveAllocation(from.id, founderId, { toCauseId: to.id, amount: "0", reason: "Shift to water." })).rejects.toThrow(
        /Enter an amount/,
      );

      const { from: f, to: t } = await service.moveAllocation(from.id, founderId, { toCauseId: to.id, amount: "350", reason: "Shift to water." });
      expect([f.allocatedAmount?.toString(), t.allocatedAmount?.toString()]).toEqual(["250", "550"]);

      const logs = await prisma.auditLog.findMany({ where: { entityId: { in: [from.id, to.id] }, action: "waqf_cause.allocation_moved" } });
      expect(logs).toHaveLength(2);
      for (const log of logs) {
        expect(log.after).toMatchObject({ move: { fromCauseId: from.id, toCauseId: to.id, amount: "350", changeReason: "Shift to water." } });
      }
    });

    test("only to an active cause of the same fund the founder owns", async () => {
      const waqf = await fund("asset", "1000", foundationId);
      const from = await cause(waqf.id, "300", "from");
      const removed = await cause(waqf.id, null, "removed");
      await service.unselectForFounder(removed.id, founderId);
      const elsewhere = await cause((await fund("asset", "1000", foundationId)).id, null, "other fund");
      const move = (toCauseId: string, who = founderId) => service.moveAllocation(from.id, who, { toCauseId, amount: "10", reason: "Testing moves." });

      await expect(move(elsewhere.id)).rejects.toThrow(NotFoundException);
      await expect(move(removed.id)).rejects.toThrow(NotFoundException);
      await expect(move(otherWaqfCauseId)).rejects.toThrow(NotFoundException);
      await expect(move(from.id)).rejects.toThrow(/different cause/);
      // Another founder can't move this fund's money.
      const mine = await cause(waqf.id, null, "mine");
      await expect(move(mine.id, otherFounderId)).rejects.toThrow(NotFoundException);
      expect(await allocatedOf(from.id)).toBe("300");
    });
  });

  describe("removing a cause", () => {
    test("needs a reason and the primary contact when it has an allocation; one without needs neither", async () => {
      const waqf = await fund("asset", "1000", foundationId);
      const allocated = await cause(waqf.id, "100", "allocated");
      await expect(service.unselectForFounder(allocated.id, founderId)).rejects.toThrow(/Please say why you're removing/);
      await expect(service.unselectForFounder(allocated.id, founderId, { reason: "No longer needed.", isPrimaryContact: false })).rejects.toThrow(
        ForbiddenException,
      );
      await service.unselectForFounder(allocated.id, founderId, { reason: "No longer needed.", isPrimaryContact: true });
      const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: allocated.id, action: "waqf_cause.unselected" } });
      expect(log.after).toMatchObject({ changeReason: "No longer needed." });

      const empty = await cause(waqf.id, null, "empty");
      await service.unselectForFounder(empty.id, founderId, { isPrimaryContact: false });
    });

    test("frees only what was never given out: a removed cause's committed money can't be allocated to a sibling", async () => {
      const waqf = await fund("asset", "1000", foundationId);
      const removed = await cause(waqf.id, "600", "removed");
      const sibling = await cause(waqf.id, "100", "sibling");
      await distribution(waqf.id, removed.id, "400", "paid");
      await service.unselectForFounder(removed.id, founderId, { reason: "Programme ended." });

      // 1000 raised − 100 allocated − 400 already given out = 500 free.
      expect(await service.allocationSummaryForFounder(waqf.id, founderId)).toMatchObject({
        currency: "NGN",
        raised: "1000",
        allocated: "100",
        heldByRemovedCauses: "400",
        available: "500",
        appliesFloor: true,
      });
      await expect(service.allocate(sibling.id, founderId, "600.01")).rejects.toThrow(/Only 600 of 1000 raised is unallocated/);
      await service.allocate(sibling.id, founderId, "600");

      // And staff can't start a new distribution on the removed cause.
      const b = await beneficiary(waqf.id);
      await expect(
        distributions.create({ waqfId: waqf.id, causeId: removed.id, beneficiaryId: b.id, amount: "10", currency: "NGN" }, officerUserId),
      ).rejects.toThrow(/has removed the cause/);
    });

    test("the cause list shows what's committed to each cause, and pending nominations under the name the Portal reads", async () => {
      const waqf = await fund("asset", "1000", foundationId);
      const c = await cause(waqf.id, "500");
      await distribution(waqf.id, c.id, "120", "paid");
      const listed = (await service.listForFounder(waqf.id, founderId))!.find((x) => x.id === c.id)!;
      expect(listed.committedAmount).toBe("120");
      expect(listed._count).toEqual({ beneficiaries: 0, distributions: 1, pendingNominations: 0 });

      const investment = await fund("investment", "1000", foundationId);
      const ic = await cause(investment.id, "500");
      expect((await service.listForFounder(investment.id, founderId))!.find((x) => x.id === ic.id)!.committedAmount).toBeNull();
    });
  });

  test("the fund's Mutawalli Officer is told when an allocation is lowered, moved or removed, not when it's raised", async () => {
    const waqf = await fund("asset", "1000", foundationId);
    const staff = await prisma.birrStaff.findUniqueOrThrow({ where: { userId: officerUserId } });
    await prisma.waqfCaseAssignment.create({ data: { waqfId: waqf.id, birrStaffId: staff.id, assignmentRole: "mutawalli_officer" } });
    const a = await cause(waqf.id, "300", "a");
    const b = await cause(waqf.id, "100", "b");
    const notices = () =>
      prisma.notification.findMany({ where: { recipientUserId: officerUserId, type: "waqf_cause.allocation_changed", linkUrl: `/ops/waqfs/${waqf.id}` } });
    const waitForCount = async (n: number) => {
      for (let i = 0; i < 50 && (await notices()).length < n; i++) await new Promise((r) => setTimeout(r, 50));
      return notices();
    };

    await service.allocate(a.id, founderId, "400");
    await service.allocate(a.id, founderId, "350", "Trimming the reserve.");
    await service.moveAllocation(a.id, founderId, { toCauseId: b.id, amount: "50", reason: "Books for the new term." });
    await service.unselectForFounder(b.id, founderId, { reason: "Merged into the first cause." });

    const sent = await waitForCount(3);
    expect(sent).toHaveLength(3);
    expect(sent.map((n) => n.body)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/₦400\.00 → ₦350\.00\. Founder's reason: "Trimming the reserve\."/),
        expect.stringMatching(/₦50\.00 moved from .* to .*\. Founder's reason: "Books for the new term\."/),
        expect.stringMatching(/\(₦150\.00 allocated\) was removed\. Founder's reason: "Merged into the first cause\."/),
      ]),
    );
  });

  test("lowering an allocation and committing a distribution at the same time can't both succeed", async () => {
    const waqf = await fund("asset", "1000", foundationId);
    const c = await cause(waqf.id, "500");
    await distribution(waqf.id, c.id, "300", "paid");
    const b = await beneficiary(waqf.id);

    // Each alone would succeed: 300 + 100 ≤ 500, and 300 ≥ the 300 committed.
    const results = await Promise.allSettled([
      service.allocate(c.id, founderId, "300", "Freeing the unused part."),
      distributions.create({ waqfId: waqf.id, causeId: c.id, beneficiaryId: b.id, amount: "100", currency: "NGN" }, officerUserId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const committed = await prisma.distribution.aggregate({
      where: { causeId: c.id, status: { in: ["pending", "approved", "disbursing", "paid"] } },
      _sum: { amount: true },
    });
    expect(new Prisma.Decimal(committed._sum.amount ?? 0).lte(new Prisma.Decimal((await allocatedOf(c.id))!))).toBe(true);
  });
});
