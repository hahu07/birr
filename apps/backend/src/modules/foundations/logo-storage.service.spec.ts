import { BadRequestException } from "@nestjs/common";
import { unlink } from "fs/promises";
import * as path from "path";
import { LogoStorageService } from "./logo-storage.service";

const REAL_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function fakeFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: "logo",
    originalname: "logo.png",
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

describe("LogoStorageService", () => {
  const service = new LogoStorageService();
  const savedUrls: string[] = [];

  afterAll(async () => {
    const uploadDir = path.join(__dirname, "..", "..", "..", "uploads", "logos");
    for (const url of savedUrls) {
      const filename = url.split("/").pop()!;
      await unlink(path.join(uploadDir, filename)).catch(() => {});
    }
  });

  test("saves an allowed PNG and returns a URL under /uploads/logos/", async () => {
    const result = await service.saveLogo(fakeFile({}));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/logos/");
  });

  test("rejects a file over 2MB", async () => {
    await expect(service.saveLogo(fakeFile({ size: 3 * 1024 * 1024 }))).rejects.toThrow(BadRequestException);
  });

  // 2026-08-30 security audit fix — the client-supplied mimetype field
  // (read straight from the multipart Content-Type header) used to be
  // trusted outright. An uploaded SVG carrying inline <script>, labeled
  // as "image/png", would have sailed through the allowlist untouched —
  // and this exact allowlist deliberately excludes SVG precisely because
  // of that XSS vector (see this service's own comment).
  test("rejects a malicious SVG mislabeled as an allowed image type", async () => {
    const maliciousSvg = Buffer.from("<svg onload=\"alert(document.cookie)\"></svg>");
    await expect(
      service.saveLogo(fakeFile({ mimetype: "image/png", originalname: "logo.png", buffer: maliciousSvg })),
    ).rejects.toThrow(BadRequestException);
  });

  test("accepts real content matching an allowed type even when the client's mimetype label is wrong", async () => {
    const result = await service.saveLogo(fakeFile({ mimetype: "application/octet-stream" }));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/logos/");
  });
});
