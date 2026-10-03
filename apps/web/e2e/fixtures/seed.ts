// Fixture creation for the Playwright suite — talks to the database
// directly via @birr/db, the same workspace package every backend spec
// already uses, rather than reinventing a second way to create a Waqf/
// Vault/BirrStaff row. This file is Node-only (imported from
// e2e/auth.setup.ts and spec-local beforeAll hooks, never from browser
// context) — Playwright runs setup/test files under Node, so a direct
// Prisma import here is the same shape backend specs already use, not a
// new pattern.
//
// Deliberately narrow: seeds exactly what each flow's test needs to
// reach its own starting point without re-driving already-covered
// backend logic through the UI (e.g. a real email inbox for
// verification, or a real WhatsApp OTP) — see auth.setup.ts's own
// comment on which steps go through real HTTP and which are seeded
// directly, and why each one was decided that way.
import { prisma } from "@birr/db";
import { hash } from "bcryptjs";
import { randomUUID } from "crypto";

// Matches apps/backend/src/common/auth/password-auth.ts's own constant —
// not imported from there (a different workspace package, and this is
// test-only data, not a runtime auth decision) but the same value for
// the same reason: a fixture password hash should cost what a real one
// costs, not be artificially cheap in a way that could mask a real
// perf issue if this constant ever changed in the app itself.
const BCRYPT_ROUNDS = 10;

export const E2E_PASSWORD = "E2e-Fixture-Password-1!";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@e2e.birr.test`;
}

/**
 * A staff user with a known password, mfaEnabled: false (not yet
 * enrolled) — auth.setup.ts drives the real enrollment HTTP flow from
 * here, rather than this function reaching into EncryptionService's
 * own format to fabricate mfaSecretEncrypted directly. That keeps this
 * fixture honest: the MFA secret this staff session ends up with is
 * the same shape a real enrollment produces, not a parallel encoding
 * that could silently drift from the real one.
 */
export async function seedStaffUser(staffRole: string = "mutawalli_officer") {
  const email = uniqueEmail("e2e-staff");
  const passwordHash = await hash(E2E_PASSWORD, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, fullName: "E2E Fixture Staff", passwordHash },
  });
  await prisma.birrStaff.create({ data: { userId: user.id, staffRole: staffRole as never } });
  return { userId: user.id, email, password: E2E_PASSWORD };
}

/**
 * A fully-established Founder: verified user, Foundation, Founder,
 * primary_contact membership — the state establishFounderAndFoundation()
 * leaves behind, for tests that need an already-established Founder
 * session (approval-queue, session-boundary) rather than re-driving
 * establishment itself (that's founder-establishment.spec.ts's own job).
 */
export async function seedEstablishedFounder() {
  const email = uniqueEmail("e2e-founder");
  const passwordHash = await hash(E2E_PASSWORD, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email,
      fullName: "E2E Fixture Founder",
      passwordHash,
      status: "active",
      whatsappVerifiedAt: new Date(),
    },
  });
  const foundation = await prisma.foundation.create({ data: { name: `E2E Fixture Foundation ${randomUUID().slice(0, 8)}` } });
  const founder = await prisma.founder.create({ data: { name: "E2E Fixture Founder Org", kind: "institution" } });
  await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId: founder.id } });
  await prisma.founderMembership.create({
    data: { founderId: founder.id, userId: user.id, permissionLevel: "primary_contact" },
  });
  return { userId: user.id, email, password: E2E_PASSWORD, founderId: founder.id, foundationId: foundation.id };
}

/**
 * An open, donatable Vault with one catalog-backed cause — the minimum
 * a donation-flow test needs to reach the contribution form. Reuses the
 * real CauseCategory catalog (seeded by packages/db/prisma/seed.ts) the
 * same way a real Ops Console staffer picking "Education" would, rather
 * than inventing a parallel one-off category per test run.
 */
export async function seedOpenVault(actorUserId: string) {
  const category = await prisma.causeCategory.findFirst({ where: { deletedAt: null } });
  if (!category) {
    throw new Error("No CauseCategory rows found — run `pnpm --filter @birr/db exec prisma db seed` first.");
  }
  const vault = await prisma.vault.create({
    data: {
      name: `E2E Fixture Vault ${randomUUID().slice(0, 8)}`,
      slug: `e2e-fixture-vault-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      type: "project",
      currency: "NGN",
      jurisdiction: "NG",
      status: "open",
      openedAt: new Date(),
      createdByUserId: actorUserId,
    },
  });
  const cause = await prisma.vaultCause.create({
    // targetAmount is what makes CauseCard render its progress bar at
    // all (see vaults/[slug]/page.tsx's own CauseCard — pct stays null,
    // and the bar doesn't render, when targetAmount is unset) — a test
    // asserting the progress bar needs this fixture to carry one.
    data: { vaultId: vault.id, causeCategoryId: category.id, name: category.name, targetAmount: "1000000" },
  });
  // NGN contribution minimum — seeded by seed.ts under normal setup, but
  // a test run against a freshly-migrated-but-unseeded database (e.g. a
  // CI misconfiguration) should fail loudly here, not with a confusing
  // "minimum contribution not configured" error surfaced mid-test deep
  // in a form-submit assertion.
  const minimum = await prisma.contributionMinimum.findUnique({ where: { currency: "NGN" } });
  if (!minimum) {
    throw new Error('No NGN contributionMinimum row — run `pnpm --filter @birr/db exec prisma db seed` first.');
  }
  return { vaultId: vault.id, slug: vault.slug, causeId: cause.id, causeName: cause.name, minimumAmount: minimum.minAmount.toString() };
}

/**
 * A draft (unpublished) Vault — the state `vault.publish`'s own
 * governed-action handler expects to transition from (see
 * VaultsService.publish's own "not draft, nothing to publish" guard).
 * Deliberately separate from seedOpenVault above, which creates an
 * already-open vault that `vault.publish` would reject outright.
 */
export async function seedDraftVault(actorUserId: string) {
  const vault = await prisma.vault.create({
    data: {
      name: `E2E Fixture Draft Vault ${randomUUID().slice(0, 8)}`,
      slug: `e2e-fixture-vault-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      type: "project",
      currency: "NGN",
      jurisdiction: "NG",
      status: "draft",
      createdByUserId: actorUserId,
    },
  });
  return { vaultId: vault.id, name: vault.name, slug: vault.slug };
}
