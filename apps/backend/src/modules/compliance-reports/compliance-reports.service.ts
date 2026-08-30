import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { TrusteeLicensesService } from "../trustee-licenses/trustee-licenses.service";
import { CompliancePolicySetsService } from "../compliance-policy-sets/compliance-policy-sets.service";

@Injectable()
export class ComplianceReportsService {
  constructor(
    private readonly trusteeLicenses: TrusteeLicensesService,
    private readonly compliancePolicySets: CompliancePolicySetsService,
  ) {}

  async generate(waqfId: string, requestedByUserId: string) {
    const waqf = await prisma.waqf.findUnique({ where: { id: waqfId } });
    if (!waqf) throw new NotFoundException(`Waqf "${waqfId}" not found.`);

    // Jurisdiction-driven, per CLAUDE.md ("waqfs.jurisdiction... is what
    // should drive which compliance policy set applies — don't hardcode
    // one jurisdiction's rules"), not the Founder's home jurisdiction.
    // policySet is null when nobody's configured one yet — surfaced as
    // an honest gap in the report rather than silently omitted, same
    // stub-not-fabricate posture as Rasid's read_regulatory_sources.
    const [governedActions, auditLogs, policySet, trusteeLicenseStatus] = await Promise.all([
      prisma.governedAction.findMany({
        where: { waqfId },
        include: {
          permission: true,
          makerUser: { select: { id: true, fullName: true } },
          makerAgent: { select: { id: true, name: true } },
          checkerUser: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      // Named actors, not just ids — a compliance report is read by
      // people outside this codebase (an external auditor, a regulator)
      // who have no way to resolve a bare actorUserId themselves.
      prisma.auditLog.findMany({
        where: { waqfId },
        include: {
          actorUser: { select: { id: true, fullName: true } },
          actorAgent: { select: { id: true, name: true } },
          actorFounder: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.compliancePolicySets.findByJurisdiction(waqf.jurisdiction),
      this.trusteeLicenses.statusForJurisdiction(waqf.jurisdiction),
    ]);

    // Exporting a compliance report is itself compliance-relevant — who
    // pulled it, and when, needs its own audit trail entry, same as every
    // other meaningful action in this codebase (even though this action
    // is a read, not a write to the report's underlying data).
    await prisma.auditLog.create({
      data: {
        waqfId,
        actorType: "birr_staff",
        actorUserId: requestedByUserId,
        action: "compliance_report.exported",
        entityType: "Waqf",
        entityId: waqfId,
      },
    });

    return { waqf, governedActions, auditLogs, policySet, trusteeLicenseStatus, generatedAt: new Date() };
  }
}
