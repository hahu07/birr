# Uploaded files — where they live and how to set it up

Birr stores uploaded files (Foundation logos, Vault cover photos and
documents, milestone evidence, message attachments, cause-category documents,
impact photos) outside the database. Where they are kept is decided by one
setting:

| `STORAGE_BUCKET` | Files are kept in | Use for |
|---|---|---|
| **not set** | the backend's local `uploads/` folder | local development and tests — no setup |
| **set** | an S3-compatible bucket | **production** |

**Why production needs a bucket.** The local folder is not durable: Render
wipes it on every deploy (its free plan has no persistent disk), and a Docker
container rebuild wipes it on a VPS too. The database would keep pointing at
files that no longer exist — broken images, and missing legal evidence. A
bucket survives redeploys and host moves, and the provider handles durability.

The backend logs a warning at startup in production if no bucket is set.

## How files are served (unchanged)

Files are still served by the backend at `/uploads/<folder>/<filename>`, and
the sign-in and ownership checks for private folders (message attachments,
Waqf milestone evidence, cause-category documents) still run first. The
backend reads the bytes from the bucket on request. So:

- keep the bucket **private** (no public access, no public URL) — people never
  talk to the bucket directly;
- no stored URL changes, so no database row needs rewriting.

## Setting it up (Cloudflare R2 shown; any S3-compatible bucket works)

1. Create a bucket (e.g. `birr-files`). Leave public access **off**.
2. Create an API token with *Object Read & Write* on that bucket only. Note the
   access key id, secret, and the account's S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).
3. Set these on the **backend** service (Render dashboard, or the VPS `.env`):
   - `STORAGE_BUCKET` — the bucket name
   - `STORAGE_ENDPOINT` — the endpoint above (omit for AWS S3)
   - `STORAGE_REGION` — `auto` for R2 (default), or the AWS region
   - `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` — from step 2
   - `STORAGE_KEY_PREFIX` — optional; lets staging and production share a bucket
4. Redeploy. A half-configured bucket (name set, keys missing) makes the backend
   refuse to start rather than quietly falling back to local disk.

## Switching an existing deployment (files already uploaded)

Do this **before** the next redeploy that would wipe them, on the machine where
the files currently are:

```bash
# with the STORAGE_* variables set in the environment
node dist/scripts/migrate-uploads-to-bucket.cli.js             # dry run — lists what would be copied
node dist/scripts/migrate-uploads-to-bucket.cli.js --execute   # copies it
```

It only copies — nothing is deleted locally — and skips anything already in the
bucket, so it is safe to run again. If the files were already lost in an earlier
redeploy, they can't be recovered by this: re-upload them in the Ops Console.

## Backups

Durable is not the same as backed up. Turn on the provider's versioning or
lifecycle rules for the bucket, or copy it periodically to a second bucket, the
same way the database dump is copied off-box (see `vps-deployment-plan.md`).
