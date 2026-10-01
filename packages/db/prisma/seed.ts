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
