import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma, BirrStaffRole } from "@birr/db";

// Break-glass MFA recovery for the one case the normal, governed
// `staff.mfa_reset` action can't cover: nobody left who can *propose* it
// (e.g. the only Platform Admin lost both their authenticator and their
// backup codes). Run from the server by whoever has production shell
// access, NOT through the web app — see docs/staff-mfa-recovery.md for
// the full procedure. It re-creates the two-person rule outside the app:
// two named, active senior staff (Board / Compliance) other than the
// person being recovered must have agreed, and their identities plus the
// reason are written to the audit trail. Dry-run unless `execute` is set.
export const EMERGENCY_APPROVER_ROLES: BirrStaffRole[] = ["board_of_trustees", "compliance_officer"];
export const MIN_REASON_LENGTH = 20;

export interface EmergencyMfaResetInput {
  targetEmail: string;
  approverEmails: [string, string];
  reason: string;
  execute: boolean;
}

export interface EmergencyMfaResetResult {
  executed: boolean;
  summary: string[];
}

const normalize = (email: string) => email.trim().toLowerCase();

async function loadActiveStaff(email: string, label: string) {
  const user = await prisma.user.findUnique({ where: { email: normalize(email) } });
  const staff = user && (await prisma.birrStaff.findUnique({ where: { userId: user.id } }));
  if (!user || !staff) throw new NotFoundException(`${label} "${email}" is not a Birr staff account.`);
  if (staff.status !== "active") throw new BadRequestException(`${label} "${email}" is not an active staff account.`);
  return { user, staff };
}

export async function emergencyMfaReset(input: EmergencyMfaResetInput): Promise<EmergencyMfaResetResult> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new BadRequestException(
      `A reason of at least ${MIN_REASON_LENGTH} characters is required — say who lost access and how their identity was confirmed.`,
    );
  }

  const [approverAEmail, approverBEmail] = input.approverEmails.map(normalize);
  const targetEmail = normalize(input.targetEmail);
  if (approverAEmail === approverBEmail) {
    throw new BadRequestException("The two approvers must be two different people.");
  }
  if (approverAEmail === targetEmail || approverBEmail === targetEmail) {
    throw new BadRequestException("An approver cannot be the person whose MFA is being reset.");
  }

  const target = await loadActiveStaff(targetEmail, "Target");
  if (!target.user.mfaEnabled) {
    throw new BadRequestException(`${target.user.fullName} has no two-factor authentication enrolled — nothing to reset.`);
  }
  const approvers = await Promise.all([
    loadActiveStaff(approverAEmail, "Approver 1"),
    loadActiveStaff(approverBEmail, "Approver 2"),
  ]);
  for (const [i, a] of approvers.entries()) {
    if (!EMERGENCY_APPROVER_ROLES.includes(a.staff.staffRole)) {
      throw new BadRequestException(
        `Approver ${i + 1} (${a.user.email}) is a ${a.staff.staffRole}; emergency approvers must be one of: ${EMERGENCY_APPROVER_ROLES.join(", ")}.`,
      );
    }
  }

  const summary = [
    `Target:     ${target.user.fullName} <${target.user.email}> (${target.staff.staffRole})`,
    `Approver 1: ${approvers[0].user.fullName} <${approvers[0].user.email}> (${approvers[0].staff.staffRole})`,
    `Approver 2: ${approvers[1].user.fullName} <${approvers[1].user.email}> (${approvers[1].staff.staffRole})`,
    `Reason:     ${reason}`,
    "Effect:     clears their authenticator secret and every backup code; they must re-enrol at next sign-in. Password unchanged.",
  ];
  if (!input.execute) return { executed: false, summary };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.user.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null } });
    await tx.mfaBackupCode.deleteMany({ where: { userId: target.user.id } });
    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: "birr_staff.mfa_reset_emergency",
        entityType: "User",
        entityId: target.user.id,
        before: { mfaEnabled: true } as any,
        after: {
          mfaEnabled: false,
          method: "emergency-script",
          approvedByUserIds: approvers.map((a) => a.user.id),
          approvedByEmails: approvers.map((a) => a.user.email),
          reason,
        } as any,
      },
    });
    // In-app only (there's no mail adapter in a one-off CLI) — the
    // runbook requires telling the person directly, out of band.
    await tx.notification.create({
      data: {
        recipientType: "birr_staff",
        recipientUserId: target.user.id,
        type: "birr_staff.mfa_reset",
        title: "Two-factor authentication on your Birr staff account was reset",
        body: `Two-factor authentication was reset through Birr's emergency recovery procedure, approved by ${approvers[0].user.fullName} and ${approvers[1].user.fullName}. You'll be asked to set up your authenticator app again at your next sign-in.`,
        linkUrl: "/ops/sign-in",
      },
    });
  });
  return { executed: true, summary };
}
