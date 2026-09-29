import { Injectable } from "@nestjs/common";
import { IsNumberString } from "class-validator";
import { prisma } from "@birr/db";
import { IsPositiveDecimal } from "../../common/validation/positive-decimal";

export class UpsertCorpusMinimumInput {
  @IsNumberString()
  @IsPositiveDecimal()
  minAmount!: string;
}

export class UpdateWaqfFundingSettingsInput {
  // Same string-not-number convention as every other Decimal-backed DTO
  // field in this codebase (see assets.service.ts's own comment: a
  // Prisma.Decimal can't cross an HTTP boundary, so every caller passes
  // a string) — installmentMinimumPercent is a Decimal column, not a
  // plain int, for the same "ops may want a fractional percent someday"
  // reasoning as every other admin-tunable number here.
  @IsNumberString()
  installmentMinimumPercent!: string;
}

@Injectable()
export class WaqfFundingService {
  // Same "silent, unaudited change is a real compliance/financial risk"
  // reasoning as TrusteeLicensesService — these two numbers gate whether
  // a founder's declared endowment is even accepted, so a change to
  // either is audit-logged like any other admin-controlled financial
  // parameter in this codebase.
  async upsertCorpusMinimum(currency: string, input: UpsertCorpusMinimumInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.corpusMinimum.findUnique({ where: { currency } });
      const updated = await tx.corpusMinimum.upsert({
        where: { currency },
        update: { minAmount: input.minAmount },
        create: { currency, minAmount: input.minAmount },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: existing ? "corpus_minimum.updated" : "corpus_minimum.created",
          entityType: "CorpusMinimum",
          entityId: updated.id,
          before: existing as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  listCorpusMinimums() {
    return prisma.corpusMinimum.findMany({ orderBy: { currency: "asc" } });
  }

  // ContributionMinimum — the floor for a single payment (as opposed to
  // CorpusMinimum's total-endowment floor above) — predates this module
  // and, until now, had no admin surface at all: it was seed-data-only,
  // with no way to correct a placeholder value short of editing
  // seed-data.ts and re-running it. Same audit posture as
  // upsertCorpusMinimum.
  async upsertContributionMinimum(currency: string, input: UpsertCorpusMinimumInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.contributionMinimum.findUnique({ where: { currency } });
      const updated = await tx.contributionMinimum.upsert({
        where: { currency },
        update: { minAmount: input.minAmount },
        create: { currency, minAmount: input.minAmount },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: existing ? "contribution_minimum.updated" : "contribution_minimum.created",
          entityType: "ContributionMinimum",
          entityId: updated.id,
          before: existing as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }

  listContributionMinimums() {
    return prisma.contributionMinimum.findMany({ orderBy: { currency: "asc" } });
  }

  /**
   * Singleton read — creates the row with the schema default if the
   * seed somehow never ran (defense in depth, not the expected path;
   * packages/db/prisma/seed.ts creates this row once on setup).
   */
  async getSettings() {
    const existing = await prisma.waqfFundingSettings.findFirst();
    if (existing) return existing;
    return prisma.waqfFundingSettings.create({ data: {} });
  }

  async updateSettings(input: UpdateWaqfFundingSettingsInput, actorUserId: string) {
    const existing = await this.getSettings();
    return prisma.$transaction(async (tx) => {
      const updated = await tx.waqfFundingSettings.update({
        where: { id: existing.id },
        data: { installmentMinimumPercent: input.installmentMinimumPercent },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "waqf_funding_settings.updated",
          entityType: "WaqfFundingSettings",
          entityId: updated.id,
          before: existing as any,
          after: updated as any,
        },
      });
      return updated;
    });
  }
}
