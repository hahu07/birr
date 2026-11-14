/**
 * Suspends the staff fixtures this test run created, once every spec file
 * has finished. They can't be deleted (audit_logs refers to their users and
 * is insert-only), but left active they pile up in the shared dev database.
 * Every later run's "notify every compliance officer" style fan-out then
 * reaches thousands of them, which filled the connection pool and timed
 * tests out (the conflict-of-interest spec, 2026-11-14).
 *
 * Only staff created during this run, with a test-domain email, are
 * touched: accounts made before the run (seeded or hand-made, even on
 * example.com) never are. Waiting for the whole run means it never
 * suspends a fixture another spec file is still using. If a run is killed
 * before this point its fixtures stay active; suspend them by hand.
 */
export default async function globalTeardown(): Promise<void> {
  const startedAt = (globalThis as { __testRunStartedAt?: Date }).__testRunStartedAt;
  if (!startedAt) return;
  const { prisma } = await import("@birr/db");
  const { count } = await prisma.birrStaff.updateMany({
    where: {
      status: "active",
      createdAt: { gte: startedAt },
      user: { OR: [{ email: { endsWith: "@example.com" } }, { email: { endsWith: "@example.test" } }] },
    },
    data: { status: "suspended" },
  });
  if (count > 0) console.log(`\nSuspended ${count} test staff fixture(s) created by this run.`);
  await prisma.$disconnect();
}
