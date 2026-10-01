// Command-line wrapper for emergency-mfa-reset.ts — compiled into
// dist/scripts/ by `nest build`, so it's available in the production
// container with its normal environment (DATABASE_URL):
//
//   node dist/scripts/emergency-mfa-reset.cli.js \
//     --target lost-admin@birr.org \
//     --approver-1 board.member@birr.org --approver-2 compliance@birr.org \
//     --reason "Platform admin lost phone + backup codes; identity confirmed on video call 2026-10-01"
//
// Prints what it WOULD do and changes nothing unless --execute is added.
// Full procedure (who may run it, what must happen first): docs/staff-mfa-recovery.md
import { emergencyMfaReset } from "../modules/birr-staff/emergency-mfa-reset";
import { prisma } from "@birr/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const target = arg("target");
  const approver1 = arg("approver-1");
  const approver2 = arg("approver-2");
  const reason = arg("reason");
  if (!target || !approver1 || !approver2 || !reason) {
    console.error('Usage: --target <email> --approver-1 <email> --approver-2 <email> --reason "<why>" [--execute]');
    process.exit(2);
  }
  const execute = process.argv.includes("--execute");

  const result = await emergencyMfaReset({ targetEmail: target, approverEmails: [approver1, approver2], reason, execute });
  console.log(result.summary.join("\n"));
  console.log(
    result.executed
      ? "\nDONE. MFA was reset and an audit record (birr_staff.mfa_reset_emergency) was written. Tell the person directly, now."
      : "\nDRY RUN — nothing was changed. Re-run with --execute once both approvers have confirmed.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(`\nRefused: ${err instanceof Error ? err.message : err}`);
    await prisma.$disconnect();
    process.exit(1);
  });
