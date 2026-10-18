import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma, BirrStaffRole } from "@birr/db";
import { assertStaffInvitable, invitationAuditSnapshot, newInvitationToken } from "../invitations/invitations.service";
import { EMERGENCY_APPROVER_ROLES, MIN_REASON_LENGTH } from "./emergency-mfa-reset";
import { ROLE_NAMES, holdsAnyRole, roleNames } from "../../common/auth/staff-roles";

// First-setup counterpart to the `staff.invite` governed action. Adding a
// staff member needs a board_of_trustees / compliance_officer member to
// approve it — so on a brand-new deployment, where only the seeded
// platform_admin exists, nobody can approve the first approver. Owner
// decision (2026-10-18): that one case is covered by this server-side
// script, run by whoever has production shell access, not by any in-app
// exception to the two-person rule. It refuses to run once any active
// Board/Compliance member exists, so it can't become a routine way around
// the approval. Dry-run unless `execute` is set.
//
// There's no mail adapter in a one-off CLI, so the invitation link is
// returned for the operator to hand to the new approver directly, out of
// band — same "tell the person directly" posture as emergency-mfa-reset.ts.

export interface BootstrapFirstApproverInput {
  email: string;
  staffRole: string;
  invitedByEmail: string;
  reason: string;
  execute: boolean;
}

export interface BootstrapFirstApproverResult {
  executed: boolean;
  summary: string[];
  acceptUrl?: string;
}

function findActiveApprover() {
  return prisma.birrStaff.findFirst({
    where: { status: "active", ...holdsAnyRole(...EMERGENCY_APPROVER_ROLES) },
    include: { user: { select: { email: true } } },
  });
}

// `deps.findActiveApprover` is replaceable only so a test can exercise the
// "no approver exists yet" path against a shared database that always has
// some; the CLI never passes it.
export async function bootstrapFirstApprover(
  input: BootstrapFirstApproverInput,
  deps: { findActiveApprover?: () => Promise<{ user: { email: string } } | null> } = {},
): Promise<BootstrapFirstApproverResult> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new BadRequestException(
      `A reason of at least ${MIN_REASON_LENGTH} characters is required — say who this is and why they're being added this way.`,
    );
  }
  if (!EMERGENCY_APPROVER_ROLES.includes(input.staffRole as BirrStaffRole)) {
    throw new BadRequestException(
      `This script only adds a first approver (${EMERGENCY_APPROVER_ROLES.join(" or ")}); every other role is invited through the Staff page.`,
    );
  }
  const staffRole = input.staffRole as BirrStaffRole;

  const existingApprover = await (deps.findActiveApprover ?? findActiveApprover)();
  if (existingApprover) {
    throw new BadRequestException(
      `An active Board/Compliance member already exists (${existingApprover.user.email}) — propose new staff from the Staff page and have them approve it instead.`,
    );
  }

  const email = input.email.trim().toLowerCase();
  await assertStaffInvitable(email, prisma);

  const inviterUser = await prisma.user.findUnique({ where: { email: input.invitedByEmail.trim().toLowerCase() } });
  const inviter = inviterUser && (await prisma.birrStaff.findUnique({ where: { userId: inviterUser.id }, include: ROLE_NAMES }));
  if (!inviterUser || !inviter || inviter.status !== "active" || !roleNames(inviter).includes("platform_admin")) {
    throw new NotFoundException(`"${input.invitedByEmail}" is not an active platform_admin.`);
  }

  const summary = [
    `Invitee:    ${email} (${staffRole})`,
    `Invited by: ${inviterUser.fullName} <${inviterUser.email}> (platform_admin)`,
    `Reason:     ${reason}`,
    "Effect:     creates a 7-day staff invitation and prints its link. No email is sent — hand the link to the person directly.",
  ];
  if (!input.execute) return { executed: false, summary };

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: { inviteeKind: "birr_staff", email, roleKey: staffRole, invitedBy: inviterUser.id, ...newInvitationToken() },
    });
    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: "invitation.bootstrap_sent",
        entityType: "Invitation",
        entityId: created.id,
        after: { ...invitationAuditSnapshot(created), method: "bootstrap-script", reason },
      },
    });
    return created;
  });

  const portalUrl = process.env.FOUNDER_PORTAL_URL ?? "http://localhost:3000";
  return { executed: true, summary, acceptUrl: `${portalUrl}/ops/accept-invitation?token=${invitation.token}` };
}
