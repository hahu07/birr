// One-time copy of files already on local disk (apps/backend/uploads/*) into
// the S3-compatible bucket, for switching an existing deployment over to
// bucket storage (STORAGE_BUCKET, see common/storage/file-storage.service.ts).
//
//   node dist/scripts/migrate-uploads-to-bucket.cli.js            # dry run: lists what would be copied
//   node dist/scripts/migrate-uploads-to-bucket.cli.js --execute  # copies it
//
// Run it where the files currently live (the old server/volume), with the
// bucket's STORAGE_* variables set. Safe to repeat: a file already in the
// bucket is skipped, and nothing is ever deleted locally. Stored URLs
// (/uploads/<folder>/<filename>) don't change, so no database rows are touched.
import { readdir } from "fs/promises";
import * as path from "path";
import { LocalDiskDriver, driverFromEnv } from "../common/storage/file-storage.service";

async function main() {
  const { driver: bucket, kind } = driverFromEnv();
  if (kind !== "bucket") {
    console.error("STORAGE_BUCKET is not set — nothing to migrate to. Set the bucket's STORAGE_* variables first.");
    process.exit(2);
  }
  const execute = process.argv.includes("--execute");
  const root = path.join(__dirname, "..", "..", "uploads");
  const local = new LocalDiskDriver(root);

  let copied = 0;
  let skipped = 0;
  let missing = 0;
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const folder of folders.filter((d) => d.isDirectory())) {
    for (const file of await readdir(path.join(root, folder.name), { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const label = `${folder.name}/${file.name}`;
      if ((await bucket.get(folder.name, file.name)) !== null) {
        skipped++;
        continue;
      }
      const body = await local.get(folder.name, file.name);
      if (!body) {
        missing++;
        continue;
      }
      if (execute) await bucket.put(folder.name, file.name, body);
      console.log(`${execute ? "copied" : "would copy"}  ${label}`);
      copied++;
    }
  }
  console.log(
    `\n${execute ? "Done" : "DRY RUN — nothing changed"}: ${copied} to copy, ${skipped} already in the bucket${missing ? `, ${missing} unreadable` : ""}.` +
      (execute ? "" : "\nRe-run with --execute to copy them."),
  );
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
