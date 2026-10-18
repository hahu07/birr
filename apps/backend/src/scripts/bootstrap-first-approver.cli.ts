// Command-line wrapper for bootstrap-first-approver.ts — compiled into
// dist/scripts/ by `nest build`, so it's available in the production
// container with its normal environment (DATABASE_URL, FOUNDER_PORTAL_URL):
//
//   node dist/scripts/bootstrap-first-approver.cli.js \
//     --email amina.yusuf@birr.org --role board_of_trustees \
//     --invited-by admin@birr.org \
//     --reason "First Board member on a new deployment; identity confirmed in person 2026-10-18"
//
// Prints what it WOULD do and changes nothing unless --execute is added.
// Only works while no active Board/Compliance member exists.
import { bootstrapFirstApprover } from "../modules/birr-staff/bootstrap-first-approver";
import { prisma } from "@birr/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const role = arg("role");
  const invitedBy = arg("invited-by");
  const reason = arg("reason");
  if (!email || !role || !invitedBy || !reason) {
    console.error(
      'Usage: --email <email> --role <board_of_trustees|compliance_officer> --invited-by <platform admin email> --reason "<why>" [--execute]',
    );
    process.exit(2);
  }
  const execute = process.argv.includes("--execute");

  const result = await bootstrapFirstApprover({ email, staffRole: role, invitedByEmail: invitedBy, reason, execute });
  console.log(result.summary.join("\n"));
  console.log(
    result.executed
      ? `\nDONE. Invitation created and audit-logged (invitation.bootstrap_sent).\nGive this link to the person directly — it is not emailed:\n\n  ${result.acceptUrl}\n`
      : "\nDRY RUN — nothing was changed. Re-run with --execute.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(`\nRefused: ${err instanceof Error ? err.message : err}`);
    await prisma.$disconnect();
    process.exit(1);
  });
