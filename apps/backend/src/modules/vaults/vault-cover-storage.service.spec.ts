import { BadRequestException } from "@nestjs/common";
import { unlink } from "fs/promises";
import * as path from "path";
import { VaultCoverStorageService, MAX_SIZE_BYTES } from "./vault-cover-storage.service";

const REAL_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function fakeFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: "cover",
    originalname: "cover.png",
    encoding: "7bit",
    mimetype: "image/png",
    buffer: REAL_PNG_BYTES,
    size: REAL_PNG_BYTES.length,
    stream: undefined as any,
    destination: "",
    filename: "",
    path: "",
    ...overrides,
  };
}

// Mirrors LogoStorageService's own spec exactly — same convention (see
// this service's own top-of-file comment), same real security-audit
// finding (a client-supplied mimetype header can't be trusted), just a
// different upload dir, size limit, and allowed-type set (WebP included,
// per VaultCoverStorageService's own ALLOWED_MIME_TYPES).
describe("VaultCoverStorageService", () => {
  const service = new VaultCoverStorageService();
  const savedUrls: string[] = [];

  afterAll(async () => {
    const uploadDir = path.join(__dirname, "..", "..", "..", "uploads", "vault-covers");
    for (const url of savedUrls) {
      const filename = url.split("/").pop()!;
      await unlink(path.join(uploadDir, filename)).catch(() => {});
    }
  });

  test("saves an allowed PNG and returns a URL under /uploads/vault-covers/", async () => {
    const result = await service.saveCover(fakeFile({}));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/vault-covers/");
  });

  test("rejects a file over the size limit", async () => {
    await expect(service.saveCover(fakeFile({ size: MAX_SIZE_BYTES + 1 }))).rejects.toThrow(BadRequestException);
  });

  // Same 2026-08-30 security audit fix LogoStorageService's own spec
  // covers — the client-supplied mimetype field is never trusted, only
  // content sniffed via detectMimeType. An uploaded SVG carrying inline
  // <script>, labeled as "image/png", must still be rejected — this
  // allowlist deliberately excludes SVG for exactly that XSS vector.
  test("rejects a malicious SVG mislabeled as an allowed image type", async () => {
    const maliciousSvg = Buffer.from('<svg onload="alert(document.cookie)"></svg>');
    await expect(
      service.saveCover(fakeFile({ mimetype: "image/png", originalname: "cover.png", buffer: maliciousSvg })),
    ).rejects.toThrow(BadRequestException);
  });

  test("accepts real content matching an allowed type even when the client's mimetype label is wrong", async () => {
    const result = await service.saveCover(fakeFile({ mimetype: "application/octet-stream" }));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/vault-covers/");
  });
});
