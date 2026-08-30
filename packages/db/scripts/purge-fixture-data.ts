// One-time cleanup of the local dev database's accumulated test-fixture
// data (users, staff, founders, foundations, waqfs, and everything under
// them, plus the newly-added Notification table's ~18k test-only rows).
// Scoped strictly to rows NOT connected to the small set of real,
// non-fixture users identified by hand (see the audit script run
// alongside this one) — real data is left completely untouched.
//
// audit_logs is never touched here (DELETE is revoked at the DB role
// level per CLAUDE.md's immutable-audit-trail requirement — confirmed
// live: attempting it throws a real permission-denied error, by
// design). User rows are also left in place even when they're pure test
// fixtures, because ON DELETE behavior on audit_logs.actorUserId would
// require an implicit write to that same table — same block. Orphaned
// fixture Users are harmless once every BirrStaff/FounderMembership row
// pointing at them is gone: no active role, no founder membership,
// invisible to every real feature.
import { prisma } from "@birr/db";

const isFixtureEmail = { OR: [{ email: { endsWith: "@example.com" } }, { email: { endsWith: "@example.test" } }] };

async function main() {
  const realUsers = await prisma.user.findMany({ where: { NOT: isFixtureEmail }, select: { id: true, email: true } });
  const keepUserIds = realUsers.map((u) => u.id);
  console.log(`Keeping ${keepUserIds.length} real users:`, realUsers.map((u) => u.email));

  const realFounders = await prisma.founder.findMany({
    where: { memberships: { some: { userId: { in: keepUserIds } } } },
    select: { id: true, name: true },
  });
  const keepFounderIds = realFounders.map((f) => f.id);
  console.log(`Keeping ${keepFounderIds.length} real founders:`, realFounders.map((f) => f.name));

  const keepFoundations = await prisma.foundation.findMany({
    where: { foundationFounders: { some: { founderId: { in: keepFounderIds } } } },
    select: { id: true, name: true },
  });
  const keepFoundationIds = keepFoundations.map((f) => f.id);
  console.log(`Keeping ${keepFoundationIds.length} real foundations:`, keepFoundations.map((f) => f.name));

  const realWaqfs = await prisma.waqf.findMany({
    where: { foundationId: { in: keepFoundationIds } },
    select: { id: true, name: true },
  });
  // waqf_deeds has its own DB-level immutability trigger (DELETE blocked
  // outright, discovered mid-run) — any waqf with a signed deed can
  // never be removed, fixture or not, same posture as audit_logs. Those
  // must join the keep-set too, or every later step touching Waqf fails.
  const deedLockedWaqfs = await prisma.waqf.findMany({
    where: { waqfDeed: { isNot: null }, id: { notIn: realWaqfs.map((w) => w.id) } },
    select: { id: true, name: true },
  });
  console.log(
    `Keeping ${deedLockedWaqfs.length} additional fixture waqfs — deed-locked, cannot be hard-deleted (immutability trigger on waqf_deeds).`,
  );
  const keepWaqfIds = [...realWaqfs.map((w) => w.id), ...deedLockedWaqfs.map((w) => w.id)];
  console.log(`Keeping ${keepWaqfIds.length} waqfs total (${realWaqfs.length} real + ${deedLockedWaqfs.length} deed-locked):`, realWaqfs.map((w) => w.name));

  // Deed-locked waqfs can pin their Foundation/Founder too (Waqf.foundationId
  // is a required FK — RESTRICT) — extend the foundation/founder keep-sets
  // to match, or Foundation/Founder deletion fails the same way.
  const deedLockedWaqfFoundationIds = await prisma.waqf.findMany({
    where: { id: { in: deedLockedWaqfs.map((w) => w.id) } },
    select: { foundationId: true },
  });
  keepFoundationIds.push(...new Set(deedLockedWaqfFoundationIds.map((w) => w.foundationId)));
  const deedLockedFoundationFounders = await prisma.foundationFounder.findMany({
    where: { foundationId: { in: keepFoundationIds } },
    select: { founderId: true },
  });
  keepFounderIds.push(...new Set(deedLockedFoundationFounders.map((ff) => ff.founderId).filter((id) => !keepFounderIds.includes(id))));

  // A Foundation can carry its own FoundationDeed directly (CLAUDE.md: one
  // deed now covers a Foundation and every Waqf Fund under it) even when
  // none of its individual Waqfs has a WaqfDeed of their own — WaqfDeed is
  // the superseded per-fund model, nothing writes a new one. Missing this
  // case blows up the final foundation.deleteMany() below on the
  // foundation_deeds FK (discovered by actually running this script).
  const foundationDeedLockedFoundations = await prisma.foundation.findMany({
    where: { foundationDeed: { isNot: null }, id: { notIn: keepFoundationIds } },
    select: { id: true, name: true },
  });
  console.log(
    `Keeping ${foundationDeedLockedFoundations.length} additional fixture foundations — deed-locked directly (immutability trigger on foundation_deeds).`,
  );
  keepFoundationIds.push(...foundationDeedLockedFoundations.map((f) => f.id));
  const foundationDeedLockedFounders = await prisma.foundationFounder.findMany({
    where: { foundationId: { in: foundationDeedLockedFoundations.map((f) => f.id) } },
    select: { founderId: true },
  });
  keepFounderIds.push(...new Set(foundationDeedLockedFounders.map((ff) => ff.founderId).filter((id) => !keepFounderIds.includes(id))));

  const keepBirrStaff = await prisma.birrStaff.findMany({
    where: { userId: { in: keepUserIds } },
    select: { id: true },
  });
  const keepBirrStaffIds = keepBirrStaff.map((s) => s.id);

  const keepWaqfCauses = await prisma.waqfCause.findMany({
    where: { waqfId: { in: keepWaqfIds } },
    select: { id: true },
  });
  const keepWaqfCauseIds = keepWaqfCauses.map((c) => c.id);

  await prisma.$transaction(async (tx) => {
    const r1 = await tx.notification.deleteMany({ where: { recipientUserId: { notIn: keepUserIds } } });
    console.log(`Deleted ${r1.count} Notification rows`);

    const r2 = await tx.whatsAppOtp.deleteMany({ where: { userId: { notIn: keepUserIds } } });
    console.log(`Deleted ${r2.count} WhatsAppOtp rows`);

    const r3 = await tx.causeImpactUpdate.deleteMany({ where: { waqfCauseId: { notIn: keepWaqfCauseIds } } });
    console.log(`Deleted ${r3.count} CauseImpactUpdate rows`);

    const r4 = await tx.governedAction.deleteMany({
      where: {
        AND: [
          { OR: [{ waqfId: null }, { waqfId: { notIn: keepWaqfIds } }] },
          { OR: [{ makerUserId: null }, { makerUserId: { notIn: keepUserIds } }] },
          { OR: [{ checkerUserId: null }, { checkerUserId: { notIn: keepUserIds } }] },
        ],
      },
    });
    console.log(`Deleted ${r4.count} GovernedAction rows`);

    const r5 = await tx.conflictOfInterestDeclaration.deleteMany({
      where: {
        AND: [
          { OR: [{ waqfId: null }, { waqfId: { notIn: keepWaqfIds } }] },
          { birrStaffId: { notIn: keepBirrStaffIds } },
        ],
      },
    });
    console.log(`Deleted ${r5.count} ConflictOfInterestDeclaration rows`);

    const r6 = await tx.distribution.deleteMany({ where: { waqfId: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r6.count} Distribution rows`);

    const r7 = await tx.waqfCause.deleteMany({ where: { waqfId: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r7.count} WaqfCause rows`);

    const r8 = await tx.contribution.deleteMany({ where: { waqfId: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r8.count} Contribution rows`);

    const r9 = await tx.waqfDeed.deleteMany({ where: { waqfId: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r9.count} WaqfDeed rows`);

    const r10 = await tx.waqfCaseAssignment.deleteMany({ where: { waqfId: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r10.count} WaqfCaseAssignment rows`);

    const r11 = await tx.asset.deleteMany({ where: { waqfId: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r11.count} Asset rows`);

    const r12 = await tx.beneficiary.deleteMany({ where: { waqfId: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r12.count} Beneficiary rows`);

    const r13 = await tx.investment.deleteMany({ where: { waqfId: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r13.count} Investment rows`);

    const r14 = await tx.causeCategorySuggestion.deleteMany({
      where: { proposedByFounderId: { notIn: keepFounderIds } },
    });
    console.log(`Deleted ${r14.count} CauseCategorySuggestion rows`);

    const r15 = await tx.invitation.deleteMany({
      where: { AND: [{ founderId: { not: null } }, { founderId: { notIn: keepFounderIds } }] },
    });
    console.log(`Deleted ${r15.count} Invitation rows`);

    const r16 = await tx.waqf.deleteMany({ where: { id: { notIn: keepWaqfIds } } });
    console.log(`Deleted ${r16.count} Waqf rows`);

    const r17 = await tx.founderMembership.deleteMany({ where: { founderId: { notIn: keepFounderIds } } });
    console.log(`Deleted ${r17.count} FounderMembership rows`);

    const r18 = await tx.birrStaff.deleteMany({ where: { userId: { notIn: keepUserIds } } });
    console.log(`Deleted ${r18.count} BirrStaff rows`);

    const r19 = await tx.foundationFounder.deleteMany({ where: { founderId: { notIn: keepFounderIds } } });
    console.log(`Deleted ${r19.count} FoundationFounder rows`);

    const r20 = await tx.foundation.deleteMany({ where: { id: { notIn: keepFoundationIds } } });
    console.log(`Deleted ${r20.count} Foundation rows`);

    // Founder, like User, can be pinned by audit_logs.actorFounderId
    // (self-service Foundation/Waqf establishment writes founder-
    // attributed audit entries) — deleting one would require an
    // implicit UPDATE on audit_logs, blocked by the same DB-level
    // revoke. Discovered mid-run: left in place, same as fixture Users —
    // harmless once every FounderMembership/FoundationFounder pointing
    // at it is already gone (done above).
  });

  console.log(
    "\nDone. Fixture Users and Founders remain in place (audit-log-pinned — actorUserId/actorFounderId — cannot be hard-deleted), but are now harmless: no active role, no membership, no foundation link.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
