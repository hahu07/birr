import { prisma } from "@birr/db";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { CounterpartiesService } from "./counterparties.service";
import { EncryptionService } from "../../common/settings/encryption.service";

describe("CounterpartiesService", () => {
  const service = new CounterpartiesService(new EncryptionService());

  const counterpartyIds: string[] = [];
  let actorUserId: string;
  let shariahApproverUserId: string;

  beforeAll(async () => {
    // Fixture Users/BirrStaff not cleaned up in afterAll — same reasoning
    // as other spec files (referenced via audit_logs.actorUserId, which
    // is insert-only at the DB role level).
    const actorUser = await prisma.user.create({
      data: { email: `counterparties-actor-${randomUUID()}@example.com`, fullName: "Test Actor" },
    });
    actorUserId = actorUser.id;
    await prisma.birrStaff.create({ data: { userId: actorUser.id, staffRole: "investment_committee" } });

    const shariahUser = await prisma.user.create({
      data: { email: `counterparties-shariah-${randomUUID()}@example.com`, fullName: "Shariah Approver" },
    });
    shariahApproverUserId = shariahUser.id;
    await prisma.birrStaff.create({ data: { userId: shariahUser.id, staffRole: "shariah_board_member" } });
  });

  afterAll(async () => {
    await prisma.counterparty.deleteMany({ where: { id: { in: counterpartyIds } } });
    await prisma.$disconnect();
  });

  test("register() creates the row at pending_review and audit-logs it", async () => {
    const counterparty = await service.register(
      { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);

    expect(counterparty.status).toBe("pending_review");
    expect(counterparty.shariahApprovedAt).toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: counterparty.id, action: "counterparty.registered" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorType: "birr_staff", actorUserId });
  });

  test("register() accepts the full KYC profile fields", async () => {
    const counterparty = await service.register(
      {
        name: `Fixture Business ${randomUUID()}`,
        institutionType: "business",
        jurisdiction: "AE",
        registrationNumber: "REG-12345",
        address: "1 Sheikh Zayed Rd, Dubai, UAE",
        businessActivities: "Real estate development and leasing",
        website: "https://example.com",
        contactName: "Jane Doe",
        contactEmail: "jane@example.com",
        contactPhone: "+971500000000",
      },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);

    expect(counterparty).toMatchObject({
      institutionType: "business",
      registrationNumber: "REG-12345",
      address: "1 Sheikh Zayed Rd, Dubai, UAE",
      businessActivities: "Real estate development and leasing",
      website: "https://example.com",
      contactName: "Jane Doe",
      contactEmail: "jane@example.com",
      contactPhone: "+971500000000",
    });
  });

  test("update() corrects the profile without touching status or shariahApprovedAt, and audit-logs it", async () => {
    const counterparty = await service.register(
      { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);
    await service.recordShariahApproval(counterparty.id, shariahApproverUserId);

    const updated = await service.update(
      counterparty.id,
      { address: "New address", contactEmail: "updated@example.com" },
      actorUserId,
    );

    expect(updated.address).toBe("New address");
    expect(updated.contactEmail).toBe("updated@example.com");
    // Untouched by a generic update — these stay on their own gates.
    expect(updated.status).toBe("pending_review");
    expect(updated.shariahApprovedAt).not.toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: counterparty.id, action: "counterparty.updated" } });
    expect(logs).toHaveLength(1);
  });

  test("update() rejects an unknown counterparty", async () => {
    await expect(service.update(randomUUID(), { address: "x" }, actorUserId)).rejects.toThrow(NotFoundException);
  });

  test("recordShariahApproval() sets the sign-off and rejects a second attempt", async () => {
    const counterparty = await service.register(
      { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);

    const approved = await service.recordShariahApproval(counterparty.id, shariahApproverUserId);
    expect(approved.shariahApprovedByUserId).toBe(shariahApproverUserId);
    expect(approved.shariahApprovedAt).not.toBeNull();

    await expect(service.recordShariahApproval(counterparty.id, shariahApproverUserId)).rejects.toThrow(ConflictException);
  });

  test("recordShariahApproval() rejects a counterparty that isn't awaiting review", async () => {
    const counterparty = await service.register(
      { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);

    // Directly force it to `active` with no Shariah approval on record, to
    // isolate the status check from the "already approved" check above
    // (which would otherwise fire first, correctly, once approved).
    await prisma.counterparty.update({ where: { id: counterparty.id }, data: { status: "active" } });

    await expect(service.recordShariahApproval(counterparty.id, shariahApproverUserId)).rejects.toThrow(BadRequestException);
  });

  test("setConcentrationLimit() sets the ceiling and audit-logs it", async () => {
    const counterparty = await service.register(
      { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);

    const updated = await service.setConcentrationLimit(counterparty.id, { amount: "50000", currency: "USD" }, actorUserId);
    expect(updated.concentrationLimit?.toString()).toBe("50000");

    const logs = await prisma.auditLog.findMany({
      where: { entityId: counterparty.id, action: "counterparty.concentration_limit_set" },
    });
    expect(logs).toHaveLength(1);
  });

  test("suspend() is immediate (no maker-checker) and audit-logged", async () => {
    const counterparty = await service.register(
      { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);

    const updated = await service.suspend(counterparty.id, "Regulatory concern raised", actorUserId);
    expect(updated.status).toBe("suspended");

    const logs = await prisma.auditLog.findMany({ where: { entityId: counterparty.id, action: "counterparty.suspended" } });
    expect(logs).toHaveLength(1);
  });

  test("suspend() keeps the existing Shariah approval intact — no fresh sign-off needed to reactivate", async () => {
    const counterparty = await service.register(
      { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);
    await service.recordShariahApproval(counterparty.id, shariahApproverUserId);

    const suspended = await service.suspend(counterparty.id, "Temporary hold", actorUserId);
    expect(suspended.shariahApprovedAt).not.toBeNull();

    // Reactivating a merely-suspended counterparty doesn't need a new
    // Shariah sign-off — the old one still stands.
    const reactivated = await prisma.$transaction((tx) => service.onboard(counterparty.id, tx));
    expect(reactivated.status).toBe("active");
  });

  test("blacklist() clears the Shariah approval, forcing a fresh one before reactivation", async () => {
    const counterparty = await service.register(
      { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
      actorUserId,
    );
    counterpartyIds.push(counterparty.id);
    await service.recordShariahApproval(counterparty.id, shariahApproverUserId);

    const blacklisted = await service.blacklist(counterparty.id, "Sanctions hit", actorUserId);
    expect(blacklisted.shariahApprovedAt).toBeNull();
    expect(blacklisted.shariahApprovedByUserId).toBeNull();

    // Can't reactivate yet — the old approval is gone.
    await prisma.$transaction(async (tx) => {
      await expect(service.onboard(counterparty.id, tx)).rejects.toThrow(BadRequestException);
    });

    // A fresh sign-off is recordable even while status is "blacklisted"
    // (that's exactly the state a reactivation review happens in).
    const reapproved = await service.recordShariahApproval(counterparty.id, shariahApproverUserId);
    expect(reapproved.shariahApprovedAt).not.toBeNull();

    const reactivated = await prisma.$transaction((tx) => service.onboard(counterparty.id, tx));
    expect(reactivated.status).toBe("active");
  });

  describe("deregister()", () => {
    test("soft-deletes a never-used counterparty and audit-logs it", async () => {
      const counterparty = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(counterparty.id);

      const deregistered = await service.deregister(counterparty.id, actorUserId);
      expect(deregistered.deletedAt).not.toBeNull();

      const logs = await prisma.auditLog.findMany({ where: { entityId: counterparty.id, action: "counterparty.deregistered" } });
      expect(logs).toHaveLength(1);

      // Deleted, not gone — findById still resolves it for audit/history.
      const found = await service.findById(counterparty.id);
      expect(found?.deletedAt).not.toBeNull();

      // No longer shows up in the live registry.
      const list = await service.list();
      expect(list.find((c) => c.id === counterparty.id)).toBeUndefined();
    });

    test("rejects deregistering a counterparty that has any Investment referencing it", async () => {
      const counterparty = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(counterparty.id);
      await service.recordShariahApproval(counterparty.id, shariahApproverUserId);
      await prisma.$transaction((tx) => service.onboard(counterparty.id, tx));

      const foundation = await prisma.foundation.create({ data: { name: "Counterparties Deregister Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "Counterparties Deregister Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      await prisma.investment.create({
        data: { waqfId: waqf.id, name: "Deregister Fixture Investment", instrumentType: "sukuk", allocatedAmount: "100", currency: "USD", counterpartyId: counterparty.id },
      });

      await expect(service.deregister(counterparty.id, actorUserId)).rejects.toThrow(BadRequestException);

      const reloaded = await prisma.counterparty.findUniqueOrThrow({ where: { id: counterparty.id } });
      expect(reloaded.deletedAt).toBeNull();
    });

    test("rejects deregistering an already-deregistered counterparty", async () => {
      const counterparty = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(counterparty.id);
      await service.deregister(counterparty.id, actorUserId);

      await expect(service.deregister(counterparty.id, actorUserId)).rejects.toThrow(ConflictException);
    });
  });

  describe("onboard() — gate 2, only reachable via a governed_action approval", () => {
    test("rejects onboarding with no Shariah approval recorded yet", async () => {
      const counterparty = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(counterparty.id);

      await prisma.$transaction(async (tx) => {
        await expect(service.onboard(counterparty.id, tx)).rejects.toThrow(BadRequestException);
      });

      const unchanged = await prisma.counterparty.findUniqueOrThrow({ where: { id: counterparty.id } });
      expect(unchanged.status).toBe("pending_review");
    });

    test("succeeds once Shariah approval is present, flipping status to active", async () => {
      const counterparty = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(counterparty.id);
      await service.recordShariahApproval(counterparty.id, shariahApproverUserId);

      const onboarded = await prisma.$transaction((tx) => service.onboard(counterparty.id, tx));
      expect(onboarded.status).toBe("active");
    });

    test("rejects onboarding an unknown counterparty", async () => {
      await prisma.$transaction(async (tx) => {
        await expect(service.onboard(randomUUID(), tx)).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe("exposure()", () => {
    test("sums active Investments across every waqf and computes remaining against the limit", async () => {
      const counterparty = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(counterparty.id);
      await service.setConcentrationLimit(counterparty.id, { amount: "10000", currency: "USD" }, actorUserId);

      const foundation = await prisma.foundation.create({ data: { name: "Counterparties Exposure Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "Counterparties Exposure Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      await prisma.investment.create({
        data: {
          waqfId: waqf.id,
          name: "Exposure Fixture Investment",
          instrumentType: "sukuk",
          allocatedAmount: "4000",
          currency: "USD",
          counterpartyId: counterparty.id,
          // exposure()/list() only count active investments (a still-
          // pending one hasn't cleared to commit real exposure yet) —
          // status defaults to pending_shariah_review, not active, as
          // of 20260919090000_investment_status_shariah_values.
          status: "active",
        },
      });

      const exposure = await service.exposure(counterparty.id);
      expect(exposure.totalInvested?.toString()).toBe("4000");
      expect(exposure.remaining?.toString()).toBe("6000");
    });

    // Regression coverage for the 2026-09-26 audit finding: with no
    // concentrationLimitCurrency configured, the "excludes only a KNOWN
    // mismatch" filter had nothing to mismatch against and summed every
    // currency together into one meaningless totalInvested figure.
    // totalInvested is now null in this case — real exposure is only
    // ever visible per-currency until a limit currency exists to scope
    // a single figure to.
    test("does not blend currencies into totalInvested when no concentration limit is configured yet", async () => {
      const counterparty = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(counterparty.id);
      // Deliberately no setConcentrationLimit() call.

      const foundation = await prisma.foundation.create({ data: { name: "Counterparties No-Limit Exposure Fixture Foundation" } });
      const [usdWaqf, ngnWaqf] = await Promise.all([
        prisma.waqf.create({
          data: { name: "Counterparties No-Limit USD Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
        }),
        prisma.waqf.create({
          data: { name: "Counterparties No-Limit NGN Waqf", type: "investment", jurisdiction: "NG", foundationId: foundation.id, corpusCurrency: "NGN" },
        }),
      ]);
      await Promise.all([
        prisma.investment.create({
          data: { waqfId: usdWaqf.id, name: "USD No-Limit Investment", instrumentType: "sukuk", allocatedAmount: "3000", currency: "USD", counterpartyId: counterparty.id, status: "active" },
        }),
        prisma.investment.create({
          data: { waqfId: ngnWaqf.id, name: "NGN No-Limit Investment", instrumentType: "sukuk", allocatedAmount: "500000", currency: "NGN", counterpartyId: counterparty.id, status: "active" },
        }),
      ]);

      const exposure = await service.exposure(counterparty.id);
      expect(exposure.totalInvested).toBeNull();
      expect(exposure.remaining).toBeNull();
      expect(exposure.totalInvestedByCurrency).toEqual(
        expect.arrayContaining([
          { currency: "USD", amount: "3000" },
          { currency: "NGN", amount: "500000" },
        ]),
      );
    });

    // Regression coverage for the 2026-08-31 codebase audit finding:
    // Investment has no currency field of its own (it inherits its
    // waqf's corpusCurrency) — a prior version summed allocatedAmount
    // across every waqf regardless of currency, blending a SAR
    // investment into a USD-denominated exposure figure.
    test("excludes an Investment in a different currency than the concentration limit from totalInvested", async () => {
      const counterparty = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(counterparty.id);
      await service.setConcentrationLimit(counterparty.id, { amount: "10000", currency: "USD" }, actorUserId);

      const foundation = await prisma.foundation.create({ data: { name: "Counterparties Currency Exposure Fixture Foundation" } });
      const [usdWaqf, sarWaqf] = await Promise.all([
        prisma.waqf.create({
          data: { name: "Counterparties Currency Exposure USD Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "USD" },
        }),
        prisma.waqf.create({
          data: { name: "Counterparties Currency Exposure SAR Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id, corpusCurrency: "SAR" },
        }),
      ]);
      await Promise.all([
        prisma.investment.create({
          data: { waqfId: usdWaqf.id, name: "USD Exposure Investment", instrumentType: "sukuk", allocatedAmount: "3000", currency: "USD", counterpartyId: counterparty.id, status: "active" },
        }),
        prisma.investment.create({
          data: { waqfId: sarWaqf.id, name: "SAR Exposure Investment", instrumentType: "sukuk", allocatedAmount: "9000", currency: "SAR", counterpartyId: counterparty.id, status: "active" },
        }),
      ]);

      const exposure = await service.exposure(counterparty.id);
      expect(exposure.totalInvested?.toString()).toBe("3000");
      expect(exposure.remaining?.toString()).toBe("7000");
    });
  });

  describe("list()", () => {
    test("attaches totalInvested per row via a single groupBy, not per-row exposure() calls", async () => {
      const withInvestment = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(withInvestment.id);
      const withoutInvestment = await service.register(
        { name: `Fixture Bank ${randomUUID()}`, institutionType: "bank", jurisdiction: "AE", businessActivities: "Fixture bank for automated test coverage." },
        actorUserId,
      );
      counterpartyIds.push(withoutInvestment.id);

      const foundation = await prisma.foundation.create({ data: { name: "Counterparties List Fixture Foundation" } });
      const waqf = await prisma.waqf.create({
        data: { name: "Counterparties List Fixture Waqf", type: "investment", jurisdiction: "AE", foundationId: foundation.id },
      });
      await prisma.investment.create({
        data: { waqfId: waqf.id, name: "List Fixture Investment", instrumentType: "sukuk", allocatedAmount: "2500", currency: "USD", counterpartyId: withInvestment.id, status: "active" },
      });

      const results = await service.list();
      const found = results.find((c) => c.id === withInvestment.id);
      const foundEmpty = results.find((c) => c.id === withoutInvestment.id);
      // Neither counterparty has a concentration limit configured here —
      // totalInvested (2026-09-26 audit fix) is only ever populated once
      // one exists to scope a single figure to; real exposure is still
      // visible per-currency via totalInvestedByCurrency.
      expect(found?.totalInvested).toBeNull();
      expect(found?.totalInvestedByCurrency).toEqual([{ currency: "USD", amount: "2500" }]);
      expect(foundEmpty?.totalInvested).toBeNull();
      expect(foundEmpty?.totalInvestedByCurrency).toEqual([]);
    });
  });
});
