import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { syncPermissions } from "./sync-permissions";
import {
  roles,
  permissions,
  rolePermissions,
  contributionMinimums,
  corpusMinimums,
  vaultDonorThresholds,
  causeCategories,
  shariahProhibitedSectors,
  vaultLedgerAccounts,
  waqfLedgerAccounts,
} from "./seed-data";

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

// Dev/pilot-stage bootstrap credential only — chicken-and-egg fix for
// POST /birr-staff now requiring an existing platform_admin
// (@RequiresStaffRole) to create the next one. Overridable via env so a
// shared environment isn't stuck with a published default password.
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@birr.dev";
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const SEED_ADMIN_FULL_NAME = "Platform Admin";

// Local-dev Founder Portal login — a fully-established Founder (verified
// user, Foundation, Founder, primary_contact membership), the same state
// apps/web/e2e/fixtures/seed.ts's seedEstablishedFounder() leaves behind,
// but at a fixed email so there's a known /sign-in credential without
// re-driving sign-up + email/WhatsApp verification every time. Unlike
// the admin above there's no chicken-and-egg reason for this to exist
// anywhere real, so it only runs against a database on this machine:
// skipped under NODE_ENV=production (apps/backend/Dockerfile's runner
// image sets it, which covers docker-compose's `seed` profile) AND
// unless DATABASE_URL's host is localhost — NODE_ENV alone isn't
// enough, since this script has been run from a laptop straight at
// Render's external database URL (see connectWithRetry below). A
// deployed database should never carry a Founder account with a
// published default password.
const SEED_FOUNDER_EMAIL = process.env.SEED_FOUNDER_EMAIL ?? "founder@birr.dev";
const SEED_FOUNDER_PASSWORD = process.env.SEED_FOUNDER_PASSWORD ?? "ChangeMe123!";
const SEED_FOUNDER_FULL_NAME = "Dev Founder";

// Local-dev Ops Console logins, one per non-admin BirrStaffRole, so each
// role's gates (@RequiresStaffRole and the Ops Console controls that
// mirror them) can be clicked through without inviting and onboarding a
// staff member per role by hand. Same local-database-only guard as the
// dev Founder above. MFA isn't pre-seeded — each account goes through
// the normal mandatory enrollment on first sign-in, same as the admin.
const SEED_STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? "ChangeMe123!";
const SEED_STAFF = [
  { email: "mutawalli@birr.dev", fullName: "Dev Mutawalli Officer", staffRole: "mutawalli_officer" },
  { email: "board@birr.dev", fullName: "Dev Board of Trustees", staffRole: "board_of_trustees" },
  { email: "investment@birr.dev", fullName: "Dev Investment Committee", staffRole: "investment_committee" },
  { email: "shariah@birr.dev", fullName: "Dev Shariah Board Member", staffRole: "shariah_board_member" },
  { email: "audit@birr.dev", fullName: "Dev Audit Committee", staffRole: "audit_committee" },
  { email: "compliance@birr.dev", fullName: "Dev Compliance Officer", staffRole: "compliance_officer" },
  { email: "legal@birr.dev", fullName: "Dev Legal Adviser", staffRole: "legal_adviser" },
  { email: "auditor@birr.dev", fullName: "Dev External Auditor", staffRole: "external_auditor" },
] as const;

// Only agents actually wired up in services/agents get a registry row —
// seeding one for Kashif/Rashid/Munsif would imply they're live when
// they're still config-only scaffolding. Same dev/pilot-stage
// bootstrap-credential pattern as the admin above.
//
// Rafiq's shape is different from Rasid/Nazim's scheduled batch runs —
// it's invoked on demand, from the Founder Portal's own onboarding
// wizard (POST /founders/onboarding/purpose-suggestion), not a cron
// tick — but it still needs a real registry row so
// audit_logs.actorAgentId has something to reference and it shows up
// honestly on the AI Agents oversight page, same as any other agent.
//
// Bashir is real too (services/agents/src/agents/bashir.ts) — the only
// one of the four originally-scaffolding agents not blocked on a
// data-maturity gate (Kashif/Rashid/Munsif all need real
// governed_actions/investment/beneficiary history this pre-pilot
// deployment doesn't have yet).
const agentSeeds = [
  {
    name: "rasid",
    taskType: "compliance_monitoring",
    apiKeyEnvVar: "RASID_API_KEY",
    defaultApiKey: "rasid-dev-key-change-me",
  },
  {
    name: "nazim",
    taskType: "caseload_triage",
    apiKeyEnvVar: "NAZIM_API_KEY",
    defaultApiKey: "nazim-dev-key-change-me",
  },
  {
    name: "rafiq",
    taskType: "founder_onboarding",
    apiKeyEnvVar: "RAFIQ_API_KEY",
    defaultApiKey: "rafiq-dev-key-change-me",
  },
  {
    name: "bashir",
    taskType: "business_development",
    apiKeyEnvVar: "BASHIR_API_KEY",
    defaultApiKey: "bashir-dev-key-change-me",
  },
] as const;

// Render's free-tier Postgres has repeatedly shown transient P1001
// ("can't reach database server") failures on the very first query of a
// fresh connection — found running this exact script against it: back-
// to-back attempts flip between succeeding and failing with no other
// change, including cases where an unrelated command against the same
// database succeeded seconds earlier. Not specific to any one role or
// query; a plain retry-with-backoff on the initial connection is enough
// to ride it out, since the failure is at connect time, not mid-script.
async function connectWithRetry(attempts = 5, delayMs = 3000) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      console.log(`Connect attempt ${attempt}/${attempts} failed, retrying in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  await connectWithRetry();

  // Roles, permissions and role grants — shared with the deploy-time
  // `sync:permissions` command so the two can never drift apart.
  await syncPermissions(prisma);

  for (const minimum of contributionMinimums) {
    await prisma.contributionMinimum.upsert({
      where: { currency: minimum.currency },
      update: { minAmount: minimum.minAmount },
      create: minimum,
    });
  }

  for (const minimum of corpusMinimums) {
    await prisma.corpusMinimum.upsert({
      where: { currency: minimum.currency },
      update: { minAmount: minimum.minAmount },
      create: minimum,
    });
  }

  for (const threshold of vaultDonorThresholds) {
    await prisma.vaultDonorThreshold.upsert({
      where: { currency: threshold.currency },
      update: { thresholdAmount: threshold.thresholdAmount },
      create: threshold,
    });
  }

  // Singleton — no natural unique key to upsert on, so this only ever
  // creates the row once; re-running the seed leaves an already-tuned
  // percentage alone rather than stomping it back to the default.
  const existingFundingSettings = await prisma.waqfFundingSettings.findFirst();
  if (!existingFundingSettings) {
    await prisma.waqfFundingSettings.create({ data: { installmentMinimumPercent: 25 } });
  }

  for (const category of causeCategories) {
    await prisma.causeCategory.upsert({
      where: { name: category.name },
      update: {
        description: category.description,
        icon: category.icon,
        sortOrder: category.sortOrder,
        typicalWaqfTypes: category.typicalWaqfTypes,
      },
      create: category,
    });
  }

  for (const sector of shariahProhibitedSectors) {
    await prisma.shariahProhibitedSector.upsert({
      where: { name: sector.name },
      update: { description: sector.description },
      create: sector,
    });
  }

  for (const account of vaultLedgerAccounts) {
    await prisma.vaultLedgerAccount.upsert({
      where: { code: account.code },
      update: { name: account.name, type: account.type, isSystemDefault: account.isSystemDefault },
      create: account,
    });
  }

  for (const account of waqfLedgerAccounts) {
    await prisma.waqfLedgerAccount.upsert({
      where: { code: account.code },
      update: { name: account.name, type: account.type, isSystemDefault: account.isSystemDefault },
      create: account,
    });
  }

  const adminPasswordHash = await hash(SEED_ADMIN_PASSWORD, BCRYPT_ROUNDS);
  const adminUser = await prisma.user.upsert({
    where: { email: SEED_ADMIN_EMAIL },
    update: { passwordHash: adminPasswordHash, status: "active" },
    create: {
      email: SEED_ADMIN_EMAIL,
      fullName: SEED_ADMIN_FULL_NAME,
      passwordHash: adminPasswordHash,
      status: "active",
    },
  });
  await prisma.birrStaff.upsert({
    where: { userId: adminUser.id },
    update: { staffRole: "platform_admin", status: "active" },
    create: { userId: adminUser.id, staffRole: "platform_admin" },
  });

  console.log(`Seeded ${roles.length} roles, ${permissions.length} permissions, ${Object.values(rolePermissions).reduce((n, g) => n + Object.keys(g).length, 0)} role_permissions, ${contributionMinimums.length} contribution minimums, ${corpusMinimums.length} corpus minimums, ${vaultDonorThresholds.length} vault donor thresholds, ${causeCategories.length} cause categories, ${shariahProhibitedSectors.length} shariah prohibited sectors, ${vaultLedgerAccounts.length} vault ledger accounts, ${waqfLedgerAccounts.length} waqf ledger accounts.`);
  console.log(`Seeded bootstrap platform_admin: ${SEED_ADMIN_EMAIL} (password: ${SEED_ADMIN_PASSWORD}) — change this before any shared/non-local use.`);

  const databaseHost = new URL(process.env.DATABASE_URL ?? "postgresql://unknown").hostname;
  const isLocalDevDatabase = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(databaseHost);
  if (!isLocalDevDatabase) {
    console.log(`Skipped dev Founder and dev staff logins — only seeded against a local database (host: ${databaseHost}, NODE_ENV: ${process.env.NODE_ENV ?? "unset"}).`);
  } else {
    const founderPasswordHash = await hash(SEED_FOUNDER_PASSWORD, BCRYPT_ROUNDS);
    const founderUser = await prisma.user.upsert({
      where: { email: SEED_FOUNDER_EMAIL },
      update: { passwordHash: founderPasswordHash, status: "active" },
      create: {
        email: SEED_FOUNDER_EMAIL,
        fullName: SEED_FOUNDER_FULL_NAME,
        passwordHash: founderPasswordHash,
        status: "active",
        whatsappVerifiedAt: new Date(),
      },
    });
    // Foundation/Founder have no natural unique key to upsert on — only
    // establish them the first time, so a re-run doesn't pile up a second
    // Foundation for the same login.
    const existingMembership = await prisma.founderMembership.findFirst({ where: { userId: founderUser.id } });
    if (!existingMembership) {
      const foundation = await prisma.foundation.create({ data: { name: "Dev Founder Foundation" } });
      const founder = await prisma.founder.create({ data: { name: SEED_FOUNDER_FULL_NAME, kind: "individual" } });
      await prisma.foundationFounder.create({ data: { foundationId: foundation.id, founderId: founder.id } });
      await prisma.founderMembership.create({
        data: { founderId: founder.id, userId: founderUser.id, permissionLevel: "primary_contact" },
      });
    }
    console.log(`Seeded dev Founder: ${SEED_FOUNDER_EMAIL} (password: ${SEED_FOUNDER_PASSWORD}) — local dev only, sign in at /sign-in.`);

    const staffPasswordHash = await hash(SEED_STAFF_PASSWORD, BCRYPT_ROUNDS);
    for (const s of SEED_STAFF) {
      const staffUser = await prisma.user.upsert({
        where: { email: s.email },
        update: { passwordHash: staffPasswordHash, status: "active" },
        create: { email: s.email, fullName: s.fullName, passwordHash: staffPasswordHash, status: "active" },
      });
      await prisma.birrStaff.upsert({
        where: { userId: staffUser.id },
        update: { staffRole: s.staffRole, status: "active" },
        create: { userId: staffUser.id, staffRole: s.staffRole },
      });
    }
    console.log(
      `Seeded ${SEED_STAFF.length} dev staff logins (password: ${SEED_STAFF_PASSWORD}) — local dev only, sign in at /ops/sign-in:\n` +
        SEED_STAFF.map((s) => `  ${s.staffRole.padEnd(22)} ${s.email}`).join("\n"),
    );
  }

  for (const agentSeed of agentSeeds) {
    const apiKey = process.env[agentSeed.apiKeyEnvVar] ?? agentSeed.defaultApiKey;
    const apiKeyHash = await hash(apiKey, BCRYPT_ROUNDS);
    await prisma.aiAgent.upsert({
      where: { name: agentSeed.name },
      update: { apiKeyHash, status: "active" },
      create: { name: agentSeed.name, taskType: agentSeed.taskType, apiKeyHash },
    });
    console.log(`Seeded agent "${agentSeed.name}" (API key: ${apiKey}) — change this before any shared/non-local use.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
