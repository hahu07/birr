import { Injectable } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { prisma } from "@birr/db";

export class UpsertCompliancePolicySetInput {
  @IsString()
  frameworkName!: string;

  @IsOptional()
  @IsString()
  referenceUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Omitted defaults to `true` (schema default) on create, and leaves
  // the existing value untouched on update — see this field's own
  // schema comment for why the default is conservative rather than
  // assuming no license is needed.
  @IsOptional()
  @IsBoolean()
  requiresTrusteeLicense?: boolean;
}

@Injectable()
export class CompliancePolicySetsService {
  // Determines which compliance framework a jurisdiction is represented
  // as following (see CLAUDE.md's jurisdiction-driven-compliance
  // instruction on this model) — a silent, unaudited change here is a
  // real compliance risk, same reasoning as SettingsService.set()/clear()
  // for provider credentials. Transaction keeps the write and its audit
  // row atomic.
  upsert(jurisdiction: string, input: UpsertCompliancePolicySetInput, actorUserId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.compliancePolicySet.findUnique({ where: { jurisdiction } });
      const policySet = await tx.compliancePolicySet.upsert({
        where: { jurisdiction },
        update: input,
        create: { jurisdiction, ...input },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: existing ? "compliance_policy_set.updated" : "compliance_policy_set.created",
          entityType: "CompliancePolicySet",
          entityId: policySet.id,
          before: existing as any,
          after: policySet as any,
        },
      });
      return policySet;
    });
  }

  // No-op (not a throw) if nothing exists for this jurisdiction — same
  // graceful-delete posture as SettingsService.clear().
  async remove(jurisdiction: string, actorUserId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.compliancePolicySet.findUnique({ where: { jurisdiction } });
      if (!existing) return;
      await tx.compliancePolicySet.delete({ where: { jurisdiction } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "compliance_policy_set.deleted",
          entityType: "CompliancePolicySet",
          entityId: existing.id,
          before: existing as any,
        },
      });
    });
  }

  findByJurisdiction(jurisdiction: string) {
    return prisma.compliancePolicySet.findUnique({ where: { jurisdiction } });
  }

  list() {
    return prisma.compliancePolicySet.findMany({ orderBy: { jurisdiction: "asc" } });
  }
}
