import { BadRequestException } from "@nestjs/common";
import type { Prisma, PrimaryContactSuccession } from "@birr/db";

/**
 * The swap itself, shared by both ways a succession completes: at
 * approval, when the new primary contact is already a member
 * (FounderSuccessionService.approveChange), or when someone new accepts
 * their invitation (InvitationsService.accept). Kept free of any service,
 * so InvitationsService can call it without depending on the succession
 * module. The database allows one active primary contact per Founder, so
 * the outgoing one always steps down before the new one steps up.
 */

/** The outgoing contact steps down: a viewer after a handover, revoked when they're gone. */
export async function stepDownOutgoing(tx: Prisma.TransactionClient, succession: PrimaryContactSuccession) {
  const outgoing = await tx.founderMembership.findUniqueOrThrow({ where: { id: succession.outgoingMembershipId } });
  if (outgoing.permissionLevel !== "primary_contact" || outgoing.status !== "active") {
    throw new BadRequestException("The outgoing person is no longer this Founder's primary contact, so this change no longer applies.");
  }
  const after = await tx.founderMembership.update({
    where: { id: outgoing.id },
    data: succession.kind === "handover" ? { permissionLevel: "viewer" } : { status: "revoked", revokedAt: new Date() },
  });
  await tx.auditLog.create({
    data: {
      actorType: "system",
      action: "founder_membership.primary_contact_stepped_down",
      entityType: "FounderMembership",
      entityId: outgoing.id,
      before: outgoing as unknown as Prisma.InputJsonValue,
      after: { ...after, successionId: succession.id } as unknown as Prisma.InputJsonValue,
    },
  });
  return after;
}

/** The new contact steps up, and the succession is complete. */
export async function stepUpAndComplete(tx: Prisma.TransactionClient, succession: PrimaryContactSuccession, newMembershipId: string) {
  const incoming = await tx.founderMembership.findUniqueOrThrow({ where: { id: newMembershipId } });
  if (incoming.founderId !== succession.founderId || incoming.status !== "active") {
    throw new BadRequestException("The new primary contact must be an active member of this Founder.");
  }
  const promoted =
    incoming.permissionLevel === "primary_contact"
      ? incoming
      : await tx.founderMembership.update({ where: { id: incoming.id }, data: { permissionLevel: "primary_contact" } });
  const completed = await tx.primaryContactSuccession.update({
    where: { id: succession.id },
    data: { status: "completed", completedAt: new Date(), newMembershipId: incoming.id },
  });
  await tx.auditLog.create({
    data: {
      actorType: "system",
      action: "founder_membership.primary_contact_changed",
      entityType: "FounderMembership",
      entityId: incoming.id,
      before: incoming as unknown as Prisma.InputJsonValue,
      after: { ...promoted, successionId: succession.id, outgoingMembershipId: succession.outgoingMembershipId } as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.auditLog.create({
    data: {
      actorType: "system",
      action: "founder_succession.completed",
      entityType: "PrimaryContactSuccession",
      entityId: succession.id,
      before: succession as unknown as Prisma.InputJsonValue,
      after: completed as unknown as Prisma.InputJsonValue,
    },
  });
  return completed;
}

/** For InvitationsService.accept: the approved succession an invitation belongs to, if any. */
export function successionForInvitation(tx: Prisma.TransactionClient, invitationId: string) {
  return tx.primaryContactSuccession.findUnique({ where: { invitationId } });
}
