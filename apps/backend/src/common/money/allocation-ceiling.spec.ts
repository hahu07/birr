import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@birr/db";
import { assertWithinAllocation, AllocationCeilingConfig } from "./allocation-ceiling";

function configFor(opts: {
  parentType?: string | null;
  allocatedAmount?: string | null;
  proceedsAllocatedAmount?: string | null;
  otherCurrencyCommitment?: string | null;
  alreadyCommitted?: string | null;
}): AllocationCeilingConfig {
  return {
    lockCause: jest.fn().mockResolvedValue(undefined),
    loadCauseAndParentType: jest.fn().mockResolvedValue({
      cause: {
        allocatedAmount: opts.allocatedAmount != null ? new Prisma.Decimal(opts.allocatedAmount) : null,
        proceedsAllocatedAmount: opts.proceedsAllocatedAmount != null ? new Prisma.Decimal(opts.proceedsAllocatedAmount) : null,
      },
      parentType: opts.parentType ?? "project",
    }),
    findCommittedInOtherCurrency: jest.fn().mockResolvedValue(opts.otherCurrencyCommitment ? { currency: opts.otherCurrencyCommitment } : null),
    sumCommittedInCurrency: jest.fn().mockResolvedValue(opts.alreadyCommitted != null ? new Prisma.Decimal(opts.alreadyCommitted) : null),
  };
}

describe("assertWithinAllocation", () => {
  test("allows an amount within a non-investment cause's corpus+proceeds ceiling", async () => {
    const config = configFor({ allocatedAmount: "1000", proceedsAllocatedAmount: "200", alreadyCommitted: "300" });
    await expect(assertWithinAllocation("cause-1", new Prisma.Decimal("500"), "USD", config)).resolves.toBeUndefined();
  });

  test("rejects an amount that pushes a non-investment cause past corpus+proceeds", async () => {
    const config = configFor({ allocatedAmount: "1000", proceedsAllocatedAmount: "200", alreadyCommitted: "1100" });
    await expect(assertWithinAllocation("cause-1", new Prisma.Decimal("200"), "USD", config)).rejects.toThrow(BadRequestException);
  });

  test("investment-type parent: only proceedsAllocatedAmount counts toward the ceiling, corpus is excluded", async () => {
    // Corpus (allocatedAmount) is large but must not count — only the
    // much smaller proceeds pool is real spendable income (classical
    // waqf perpetuity, CLAUDE.md's 2026-09-04 update).
    const config = configFor({ parentType: "investment", allocatedAmount: "1000000", proceedsAllocatedAmount: "50", alreadyCommitted: "0" });
    await expect(assertWithinAllocation("cause-1", new Prisma.Decimal("50"), "USD", config)).resolves.toBeUndefined();
    await expect(assertWithinAllocation("cause-1", new Prisma.Decimal("50.01"), "USD", config)).rejects.toThrow(BadRequestException);
  });

  test("rejects switching currency mid-cause even if the new amount alone would fit", async () => {
    const config = configFor({ allocatedAmount: "10000", otherCurrencyCommitment: "NGN" });
    await expect(assertWithinAllocation("cause-1", new Prisma.Decimal("1"), "USD", config)).rejects.toThrow(BadRequestException);
  });

  test("locks the cause row before reading its allocation, not after", async () => {
    const config = configFor({ allocatedAmount: "100" });
    const calls: string[] = [];
    (config.lockCause as jest.Mock).mockImplementation(async () => {
      calls.push("lock");
    });
    (config.loadCauseAndParentType as jest.Mock).mockImplementation(async () => {
      calls.push("load");
      return { cause: { allocatedAmount: new Prisma.Decimal("100"), proceedsAllocatedAmount: null }, parentType: "project" };
    });
    await assertWithinAllocation("cause-1", new Prisma.Decimal("1"), "USD", config);
    expect(calls).toEqual(["lock", "load"]);
  });

  test("treats a cause with no allocation rows as a zero ceiling", async () => {
    const config = configFor({ allocatedAmount: null, proceedsAllocatedAmount: null });
    await expect(assertWithinAllocation("cause-1", new Prisma.Decimal("0.01"), "USD", config)).rejects.toThrow(BadRequestException);
  });

  test("passes the currency through to loadCauseAndParentType, for a caller whose ceiling is itself currency-scoped (VaultCauseAllocation)", async () => {
    const config = configFor({ allocatedAmount: "100" });
    await assertWithinAllocation("cause-1", new Prisma.Decimal("1"), "EUR", config);
    expect(config.loadCauseAndParentType).toHaveBeenCalledWith("cause-1", "EUR");
  });

  test("a caller with a genuinely per-currency ceiling (findCommittedInOtherCurrency always null) allows independent commitments in two different currencies against the same cause", async () => {
    // Mirrors VaultDistributionsService's own config: unlike the bare,
    // currency-less WaqfCause ceiling this module originally guarded
    // (see the "rejects switching currency" test above), a genuinely
    // per-currency ceiling has nothing to guard against here — a cause
    // committed in USD and also committed in NGN is exactly the point.
    const usdConfig = configFor({ allocatedAmount: "1000", otherCurrencyCommitment: null, alreadyCommitted: "0" });
    const ngnConfig = configFor({ allocatedAmount: "500000", otherCurrencyCommitment: null, alreadyCommitted: "0" });
    await expect(assertWithinAllocation("cause-1", new Prisma.Decimal("1000"), "USD", usdConfig)).resolves.toBeUndefined();
    await expect(assertWithinAllocation("cause-1", new Prisma.Decimal("500000"), "NGN", ngnConfig)).resolves.toBeUndefined();
  });
});
