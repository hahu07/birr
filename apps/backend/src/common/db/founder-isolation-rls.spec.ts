import { randomUUID } from "crypto";
import { prisma } from "@birr/db";

// 2026-08-30 security audit fix (see docs/comprehensive-code-review-prompt.md)
// — proves the founder_isolation RLS policy added in
// packages/db/prisma/migrations/20260830152938_expand_founder_isolation_rls
// actually enforces isolation at the DB level, independent of any
// app-layer WHERE clause. Every query below deliberately has NO WHERE
// clause naming a founder/foundation/waqf at all — `WHERE id = $1` only —
// so a row coming back (or not) is entirely down to the RLS policy
// itself, the same defense-in-depth guarantee CLAUDE.md calls for
// ("Row-Level Security scoping by waqf/founder as a second enforcement
// layer beneath the app").
//
// Before this migration, every one of these tables had RLS disabled
// entirely — this same test, run against the pre-migration schema, would
// have returned founder A's row under a founder B session too.

async function selectIdAsFounder(founderId: string | null, table: string, id: string): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    if (founderId) {
      await tx.$executeRaw`SELECT set_config('app.current_founder_id', ${founderId}, true)`;
    }
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${table}" WHERE id = $1`, id);
    return rows.map((r) => r.id);
  });
}

describe("founder_isolation RLS policies (2026-08-30 expansion)", () => {
  let userAId: string;
  let founderAId: string;
  let founderBId: string;
  let foundationAId: string;
  let waqfAId: string;
  let waqfCauseAId: string;
  let beneficiaryAId: string;
  let assetAId: string;
  let investmentAId: string;
  let distributionAId: string;
  let contributionAId: string;
  let waqfProceedsAId: string;
  let waqfDeedAId: string;
  let beneficiaryNominationAId: string;
  let messageAId: string;
  let messageAttachmentAId: string;
  let foundationDeedAId: string;
  let causeImpactUpdateAId: string;

  beforeAll(async () => {
    const userA = await prisma.user.create({
      data: { email: `rls-fixture-${randomUUID()}@example.test`, fullName: "RLS Fixture User" },
    });
    userAId = userA.id;

    const founderA = await prisma.founder.create({ data: { name: "RLS Fixture Founder A", kind: "institution" } });
    founderAId = founderA.id;
    const founderB = await prisma.founder.create({ data: { name: "RLS Fixture Founder B", kind: "institution" } });
    founderBId = founderB.id;

    const foundationA = await prisma.foundation.create({ data: { name: "RLS Fixture Foundation A" } });
    foundationAId = foundationA.id;
    await prisma.foundationFounder.create({ data: { foundationId: foundationAId, founderId: founderAId } });
    // Deliberately no FoundationFounder row for founderB — that's the
    // whole point: founder B has no relationship to foundationA/waqfA at
    // all, so every row below must be invisible to a founder-B session.

    const waqfA = await prisma.waqf.create({
      data: { name: "RLS Fixture Waqf A", type: "asset", jurisdiction: "AE", foundationId: foundationAId },
    });
    waqfAId = waqfA.id;

    const waqfCauseA = await prisma.waqfCause.create({
      data: { waqfId: waqfAId, name: "RLS Fixture Cause A" },
    });
    waqfCauseAId = waqfCauseA.id;

    const beneficiaryA = await prisma.beneficiary.create({
      data: { waqfId: waqfAId, causeId: waqfCauseAId, name: "RLS Fixture Beneficiary A", eligibilityCriteria: "n/a" },
    });
    beneficiaryAId = beneficiaryA.id;

    const assetA = await prisma.asset.create({
      data: { waqfId: waqfAId, name: "RLS Fixture Asset A", category: "cash", estimatedValue: "100" },
    });
    assetAId = assetA.id;

    const investmentA = await prisma.investment.create({
      data: { waqfId: waqfAId, name: "RLS Fixture Investment A", instrumentType: "sukuk", allocatedAmount: "100" },
    });
    investmentAId = investmentA.id;

    const distributionA = await prisma.distribution.create({
      data: {
        waqfId: waqfAId,
        causeId: waqfCauseAId,
        beneficiaryId: beneficiaryAId,
        amount: "10",
        currency: "USD",
      },
    });
    distributionAId = distributionA.id;

    const contributionA = await prisma.contribution.create({
      data: {
        waqfId: waqfAId,
        amount: "100",
        currency: "USD",
        provider: "paystack",
        providerReference: `rls-fixture-${randomUUID()}`,
        status: "confirmed",
      },
    });
    contributionAId = contributionA.id;

    const waqfProceedsA = await prisma.waqfProceeds.create({
      data: { waqfId: waqfAId, amount: "50", currency: "USD", description: "RLS fixture", recordedByUserId: userAId },
    });
    waqfProceedsAId = waqfProceedsA.id;

    const waqfDeedA = await prisma.waqfDeed.create({
      data: {
        waqfId: waqfAId,
        signedByUserId: userAId,
        signedByFounderId: founderAId,
        typedLegalName: "RLS Fixture",
        deedTemplateVersion: "v1",
        deedText: "fixture deed text",
        affirmed: true,
      },
    });
    waqfDeedAId = waqfDeedA.id;

    const beneficiaryNominationA = await prisma.beneficiaryNomination.create({
      data: {
        waqfId: waqfAId,
        proposedByFounderId: founderAId,
        proposedByUserId: userAId,
        name: "RLS Fixture Nominee",
        eligibilityCriteria: "n/a",
      },
    });
    beneficiaryNominationAId = beneficiaryNominationA.id;

    const messageA = await prisma.message.create({
      data: { foundationId: foundationAId, senderType: "founder_user", senderUserId: userAId, body: "RLS fixture message" },
    });
    messageAId = messageA.id;

    const messageAttachmentA = await prisma.messageAttachment.create({
      data: { messageId: messageAId, fileName: "fixture.pdf", mimeType: "application/pdf", sizeBytes: 10, url: "http://example.test/fixture.pdf" },
    });
    messageAttachmentAId = messageAttachmentA.id;

    const foundationDeedA = await prisma.foundationDeed.create({
      data: {
        foundationId: foundationAId,
        signedByUserId: userAId,
        signedByFounderId: founderAId,
        typedLegalName: "RLS Fixture",
        deedTemplateVersion: "v1",
        deedText: "fixture deed text",
        affirmed: true,
      },
    });
    foundationDeedAId = foundationDeedA.id;

    const causeImpactUpdateA = await prisma.causeImpactUpdate.create({
      data: { waqfCauseId: waqfCauseAId, reportedByUserId: userAId, periodLabel: "2026 Q3", narrative: "fixture" },
    });
    causeImpactUpdateAId = causeImpactUpdateA.id;
  });

  afterAll(async () => {
    // Children first, respecting FK order. Users/Founders left in place —
    // same convention as every other spec in this codebase (audit_logs
    // and other insert-only/immutable rows may reference them).
    await prisma.messageAttachment.deleteMany({ where: { id: messageAttachmentAId } });
    await prisma.message.deleteMany({ where: { id: messageAId } });
    await prisma.causeImpactUpdate.deleteMany({ where: { id: causeImpactUpdateAId } });
    await prisma.beneficiaryNomination.deleteMany({ where: { id: beneficiaryNominationAId } });
    await prisma.distribution.deleteMany({ where: { id: distributionAId } });
    await prisma.beneficiary.deleteMany({ where: { id: beneficiaryAId } });
    // WaqfDeed/FoundationDeed are immutable once written (DB
    // trigger-enforced, same as AuditLog) — left in place, same
    // convention as every other spec touching an immutable table.
    await prisma.waqfProceeds.deleteMany({ where: { id: waqfProceedsAId } });
    await prisma.contribution.deleteMany({ where: { id: contributionAId } });
    await prisma.investment.deleteMany({ where: { id: investmentAId } });
    await prisma.asset.deleteMany({ where: { id: assetAId } });
    await prisma.waqfCause.deleteMany({ where: { id: waqfCauseAId } });
    // waqfA/foundationA themselves are left in place, same reasoning as
    // the immutable deeds above — the kept WaqfDeed/FoundationDeed rows
    // FK-reference them directly (no onDelete cascade anywhere in this
    // schema), so deleting either would fail regardless.
    await prisma.$disconnect();
  });

  test.each([
    ["assets", () => assetAId],
    ["beneficiaries", () => beneficiaryAId],
    ["investments", () => investmentAId],
    ["distributions", () => distributionAId],
    ["waqf_causes", () => waqfCauseAId],
    ["contributions", () => contributionAId],
    ["waqf_proceeds", () => waqfProceedsAId],
    ["waqf_deeds", () => waqfDeedAId],
    ["beneficiary_nominations", () => beneficiaryNominationAId],
    ["messages", () => messageAId],
    ["foundation_deeds", () => foundationDeedAId],
    ["cause_impact_updates", () => causeImpactUpdateAId],
    ["message_attachments", () => messageAttachmentAId],
  ] as [string, () => string][])(
    "%s: founder A's row is visible to founder A, invisible to founder B, at the RLS layer alone",
    async (table, getId) => {
      const id = getId();

      const asOwner = await selectIdAsFounder(founderAId, table, id);
      expect(asOwner).toEqual([id]);

      const asStranger = await selectIdAsFounder(founderBId, table, id);
      expect(asStranger).toEqual([]);

      const unscoped = await selectIdAsFounder(null, table, id);
      expect(unscoped).toEqual([id]);
    },
  );
});
