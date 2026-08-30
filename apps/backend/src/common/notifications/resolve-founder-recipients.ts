import { prisma } from "@birr/db";

/**
 * Every active founder_user who should hear about something that
 * happened to a given Waqf Fund — the join every founder-facing
 * notification trigger needs (Waqf -> Foundation -> FoundationFounder ->
 * Founder -> FounderMembership), extracted once GovernedActionsService's
 * notifyDecision() needed it a second and third time elsewhere. Returns
 * a deduped list (a Foundation can have more than one Founder, and a
 * Founder can have more than one active member).
 */
export async function resolveFounderRecipientUserIdsForWaqf(waqfId: string): Promise<string[]> {
  const waqf = await prisma.waqf.findUnique({
    where: { id: waqfId },
    select: {
      foundation: {
        select: {
          foundationFounders: {
            select: {
              founder: {
                select: {
                  memberships: { where: { status: "active" }, select: { userId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!waqf) return [];

  const recipientUserIds = new Set<string>();
  for (const foundationFounder of waqf.foundation.foundationFounders) {
    for (const membership of foundationFounder.founder.memberships) {
      recipientUserIds.add(membership.userId);
    }
  }
  return [...recipientUserIds];
}

/** Same fan-out, scoped directly by founderId — for triggers that already have it in scope (no Waqf involved). */
export async function resolveFounderTeammateUserIds(founderId: string, excludeUserId?: string): Promise<string[]> {
  const memberships = await prisma.founderMembership.findMany({
    where: { founderId, status: "active", ...(excludeUserId ? { userId: { not: excludeUserId } } : {}) },
    select: { userId: true },
  });
  return memberships.map((m) => m.userId);
}

/**
 * Same fan-out as resolveFounderRecipientUserIdsForWaqf, one hop
 * shorter — for triggers anchored directly on a foundationId rather
 * than a waqfId (e.g. a new co-founder joining the Foundation itself).
 * excludeFounderId skips one Founder's own team — harmless to omit
 * (a brand-new co-founder's team is empty anyway) but keeps "existing
 * co-founders are notified" honest.
 */
export async function resolveFounderRecipientUserIdsForFoundation(
  foundationId: string,
  excludeFounderId?: string,
): Promise<string[]> {
  const foundationFounders = await prisma.foundationFounder.findMany({
    where: { foundationId, ...(excludeFounderId ? { founderId: { not: excludeFounderId } } : {}) },
    select: {
      founder: {
        select: {
          memberships: { where: { status: "active" }, select: { userId: true } },
        },
      },
    },
  });

  const recipientUserIds = new Set<string>();
  for (const foundationFounder of foundationFounders) {
    for (const membership of foundationFounder.founder.memberships) {
      recipientUserIds.add(membership.userId);
    }
  }
  return [...recipientUserIds];
}
