import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  FileStorageService,
  LocalDiskDriver,
  S3Driver,
  assertSafeKey,
  driverFromEnv,
  type S3Like,
} from "./file-storage.service";

describe("assertSafeKey", () => {
  it("accepts the folder/uuid.ext shape every upload service uses", () => {
    expect(() => assertSafeKey("vault-covers", "0b9d8c1e-5a54-4f6e-9a39-4c8f2b1d7e10.jpg")).not.toThrow();
  });

  it("rejects path traversal, separators, hidden files and odd characters", () => {
    for (const [folder, name] of [
      ["../etc", "passwd"],
      ["logos", "../secret.png"],
      ["logos", "a/b.png"],
      ["logos", "..png"],
      ["logos", ".htaccess"],
      ["logos", "with space.png"],
      ["Logos", "a.png"],
      ["", "a.png"],
      ["logos", ""],
    ]) {
      expect(() => assertSafeKey(folder, name)).toThrow(/Unsafe storage key/);
    }
  });
});

describe("LocalDiskDriver", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "storage-test-"));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("round-trips bytes, creating the folder on first write", async () => {
    const driver = new LocalDiskDriver(root);
    await driver.put("logos", "a.png", Buffer.from("hello"));
    expect((await driver.get("logos", "a.png"))?.toString()).toBe("hello");
  });

  it("returns null for a file that doesn't exist, and refuses an unsafe key", async () => {
    const driver = new LocalDiskDriver(root);
    expect(await driver.get("logos", "missing.png")).toBeNull();
    await expect(driver.get("logos", "../x.png")).rejects.toThrow(/Unsafe/);
    await expect(driver.put("../x", "a.png", Buffer.from("x"))).rejects.toThrow(/Unsafe/);
  });
});

describe("S3Driver", () => {
  function fakeClient() {
    const sent: any[] = [];
    const objects = new Map<string, Buffer>();
    const client: S3Like = {
      async send(command: any) {
        sent.push(command);
        const { Key, Body } = command.input;
        if (command.constructor.name === "PutObjectCommand") {
          objects.set(Key, Body);
          return {};
        }
        const found = objects.get(Key);
        if (!found) throw Object.assign(new Error("not found"), { name: "NoSuchKey" });
        return { Body: { transformToByteArray: async () => new Uint8Array(found) } };
      },
    };
    return { client, sent, objects };
  }

  it("stores under <prefix><folder>/<filename> with the bucket and content type, and reads it back", async () => {
    const { client, sent } = fakeClient();
    const driver = new S3Driver(client, "birr-files", "prod/");
    await driver.put("vault-covers", "x.jpg", Buffer.from("bytes"), "image/jpeg");
    expect(sent[0].input).toMatchObject({ Bucket: "birr-files", Key: "prod/vault-covers/x.jpg", ContentType: "image/jpeg" });
    expect((await driver.get("vault-covers", "x.jpg"))?.toString()).toBe("bytes");
  });

  it("returns null when the object is missing, but surfaces any other error", async () => {
    const { client } = fakeClient();
    const driver = new S3Driver(client, "b");
    expect(await driver.get("logos", "nope.png")).toBeNull();

    const broken = new S3Driver({ send: async () => { throw Object.assign(new Error("boom"), { name: "AccessDenied" }); } }, "b");
    await expect(broken.get("logos", "a.png")).rejects.toThrow("boom");
  });

  it("refuses an unsafe key before talking to the bucket", async () => {
    const { client, sent } = fakeClient();
    await expect(new S3Driver(client, "b").get("logos", "../a.png")).rejects.toThrow(/Unsafe/);
    expect(sent).toHaveLength(0);
  });
});

describe("driverFromEnv", () => {
  it("uses local disk when no bucket is configured (dev and tests need no setup)", () => {
    expect(driverFromEnv({} as NodeJS.ProcessEnv).kind).toBe("local");
  });

  it("uses the bucket when configured, and refuses a half-configured one instead of silently falling back to disk", () => {
    const full = { STORAGE_BUCKET: "b", STORAGE_ACCESS_KEY_ID: "id", STORAGE_SECRET_ACCESS_KEY: "secret", STORAGE_ENDPOINT: "https://example.r2.cloudflarestorage.com" } as NodeJS.ProcessEnv;
    expect(driverFromEnv(full).kind).toBe("bucket");
    expect(() => driverFromEnv({ STORAGE_BUCKET: "b" } as NodeJS.ProcessEnv)).toThrow(/missing/);
  });
});

describe("FileStorageService", () => {
  it("delegates to the driver it's given", async () => {
    const calls: string[] = [];
    const service = new FileStorageService({
      put: async (f, n) => void calls.push(`put ${f}/${n}`),
      get: async (f, n) => (calls.push(`get ${f}/${n}`), Buffer.from("x")),
    });
    await service.put("logos", "a.png", Buffer.from("x"));
    expect((await service.get("logos", "a.png"))?.toString()).toBe("x");
    expect(calls).toEqual(["put logos/a.png", "get logos/a.png"]);
  });
});

// The unit tests above build the service by hand, which can't catch a
// dependency-injection mistake — and one shipped once (Nest tried to inject
// the optional `driver` parameter and the whole app failed to boot). This
// resolves it through the real module.
describe("StorageModule", () => {
  it("lets Nest create FileStorageService, and provides it to other modules (it's global)", async () => {
    const { Test } = await import("@nestjs/testing");
    const { StorageModule } = await import("./storage.module");
    const { VaultCoverStorageService } = await import("../../modules/vaults/vault-cover-storage.service");
    const moduleRef = await Test.createTestingModule({
      imports: [StorageModule],
      providers: [VaultCoverStorageService],
    }).compile();
    expect(moduleRef.get(FileStorageService)).toBeInstanceOf(FileStorageService);
    // An upload service really receives the shared instance via DI.
    expect((moduleRef.get(VaultCoverStorageService) as any).storage).toBe(moduleRef.get(FileStorageService));
  });
});
