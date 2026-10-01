import { Injectable, Logger, Optional } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "fs/promises";
import * as path from "path";

// Where every uploaded file (logos, Vault covers and documents, milestone
// evidence, message attachments, impact photos, ...) is kept.
//
// The nine upload services used to write straight to a local `uploads/`
// folder. That folder doesn't survive a redeploy on Render (no persistent
// disk on the free plan) or a container rebuild on the planned VPS — so the
// database kept pointing at files that no longer existed. This is the one
// place that decides where bytes live:
//
//   - STORAGE_BUCKET set   -> an S3-compatible bucket (Cloudflare R2,
//                             Backblaze B2, AWS S3, ...). Production.
//   - STORAGE_BUCKET unset -> local disk under apps/backend/uploads, exactly
//                             as before. Development and tests, no setup.
//
// Files are always addressed by (folder, filename) and served back through
// the same /uploads/<folder>/<filename> URLs, with the same sign-in checks
// in main.ts — so no stored URL changes and no database row is rewritten.

export interface StorageDriver {
  put(folder: string, filename: string, body: Buffer, contentType?: string): Promise<void>;
  /** The file's bytes, or null if it doesn't exist. */
  get(folder: string, filename: string): Promise<Buffer | null>;
}

const SAFE_FOLDER = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Folder and filename come from our own code (a fixed folder, a uuid filename) — but this is the path-traversal choke point, so it's checked anyway. */
export function assertSafeKey(folder: string, filename: string): void {
  if (!SAFE_FOLDER.test(folder) || !SAFE_FILENAME.test(filename) || filename.includes("..")) {
    throw new Error(`Unsafe storage key "${folder}/${filename}".`);
  }
}

export class LocalDiskDriver implements StorageDriver {
  constructor(private readonly rootDir: string = path.join(__dirname, "..", "..", "..", "uploads")) {}

  async put(folder: string, filename: string, body: Buffer): Promise<void> {
    assertSafeKey(folder, filename);
    await mkdir(path.join(this.rootDir, folder), { recursive: true });
    await writeFile(path.join(this.rootDir, folder, filename), body);
  }

  async get(folder: string, filename: string): Promise<Buffer | null> {
    assertSafeKey(folder, filename);
    try {
      return await readFile(path.join(this.rootDir, folder, filename));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

/** The subset of S3Client this driver uses — lets tests pass a fake. */
export interface S3Like {
  send(command: unknown): Promise<any>;
}

export class S3Driver implements StorageDriver {
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
    private readonly keyPrefix: string = "",
  ) {}

  private key(folder: string, filename: string): string {
    assertSafeKey(folder, filename);
    return `${this.keyPrefix}${folder}/${filename}`;
  }

  async put(folder: string, filename: string, body: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(folder, filename), Body: body, ContentType: contentType }),
    );
  }

  async get(folder: string, filename: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(folder, filename) }));
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound" || (err as any)?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }
}

/** Chooses the driver from the environment; see this file's top comment. Throws on a half-configured bucket rather than silently falling back to local disk. */
export function driverFromEnv(env: NodeJS.ProcessEnv = process.env): { driver: StorageDriver; kind: "bucket" | "local" } {
  const bucket = env.STORAGE_BUCKET;
  if (!bucket) return { driver: new LocalDiskDriver(), kind: "local" };

  const accessKeyId = env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = env.STORAGE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("STORAGE_BUCKET is set but STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY are missing.");
  }
  const endpoint = env.STORAGE_ENDPOINT || undefined;
  const client = new S3Client({
    region: env.STORAGE_REGION ?? "auto",
    endpoint,
    // Cloudflare R2, Backblaze B2 and most S3-compatible stores want path-style when an explicit endpoint is given.
    forcePathStyle: Boolean(endpoint),
    credentials: { accessKeyId, secretAccessKey },
  });
  const prefix = env.STORAGE_KEY_PREFIX ? `${env.STORAGE_KEY_PREFIX.replace(/\/+$/, "")}/` : "";
  return { driver: new S3Driver(client, bucket, prefix), kind: "bucket" };
}

@Injectable()
export class FileStorageService implements StorageDriver {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly driver: StorageDriver;

  // @Optional(): the parameter exists so tests can pass a fake driver, but
  // it's an interface (an `Object` to Nest), so without this Nest tries to
  // inject it and the app fails to start.
  constructor(@Optional() driver?: StorageDriver) {
    if (driver) {
      this.driver = driver;
      return;
    }
    const chosen = driverFromEnv();
    this.driver = chosen.driver;
    if (chosen.kind === "local" && process.env.NODE_ENV === "production") {
      this.logger.warn(
        "STORAGE_BUCKET is not set — uploaded files are being written to local disk, which is lost on a redeploy unless a persistent volume is mounted at apps/backend/uploads.",
      );
    }
  }

  put(folder: string, filename: string, body: Buffer, contentType?: string) {
    return this.driver.put(folder, filename, body, contentType);
  }

  get(folder: string, filename: string) {
    return this.driver.get(folder, filename);
  }
}
