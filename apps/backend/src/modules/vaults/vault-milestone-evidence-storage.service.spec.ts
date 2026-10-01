import sharp from "sharp";
import { BadRequestException } from "@nestjs/common";
import { readFile, unlink } from "fs/promises";
import * as path from "path";
import { VaultMilestoneEvidenceStorageService } from "./vault-milestone-evidence-storage.service";

// Real magic bytes — detectMimeType decides off file content, not the
// client-supplied mimetype field, so fixtures need to actually match to
// exercise the "legitimate file" path (same convention as
// MessageAttachmentStorageService's own spec, which this mirrors).
const REAL_PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("fixture content")]);

function fakeFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: "evidence",
    originalname: "completion-report.pdf",
    encoding: "7bit",
    mimetype: "application/pdf",
    buffer: REAL_PDF_BUFFER,
    size: REAL_PDF_BUFFER.length,
    stream: undefined as any,
    destination: "",
    filename: "",
    path: "",
    ...overrides,
  };
}

describe("VaultMilestoneEvidenceStorageService", () => {
  const service = new VaultMilestoneEvidenceStorageService();
  const savedUrls: string[] = [];

  afterAll(async () => {
    const uploadDir = path.join(__dirname, "..", "..", "..", "uploads", "vault-milestone-evidence");
    for (const url of savedUrls) {
      const filename = url.split("/").pop()!;
      await unlink(path.join(uploadDir, filename)).catch(() => {});
    }
  });

  test("saves an allowed PDF and returns a URL under /uploads/vault-milestone-evidence/", async () => {
    const result = await service.saveEvidence(fakeFile({}));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/vault-milestone-evidence/");
  });

  test("saves an allowed image — re-encoded as a metadata-free JPEG, so GPS from a phone photo never goes public", async () => {
    const withGps = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#2a7" } })
      .withExif({ IFD0: { Make: "SecretPhoneCo" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 0/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const result = await service.saveEvidence(fakeFile({ mimetype: "image/jpeg", originalname: "site-photo.jpg", buffer: withGps }));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/vault-milestone-evidence/");
    expect(result.url.endsWith(".jpg")).toBe(true);

    const stored = await readFile(path.join(__dirname, "..", "..", "..", "uploads", "vault-milestone-evidence", path.basename(result.url)));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(Buffer.from("SecretPhoneCo"))).toBe(false);
  });

  test("rejects a file that only claims to be an image (valid PNG header, undecodable body)", async () => {
    const pngHeaderOnly = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    await expect(
      service.saveEvidence(fakeFile({ mimetype: "image/png", originalname: "fake.png", buffer: pngHeaderOnly })),
    ).rejects.toThrow(/couldn't be read/);
  });

  test("rejects a disallowed mimetype (e.g. SVG)", async () => {
    await expect(
      service.saveEvidence(fakeFile({ mimetype: "image/svg+xml", originalname: "logo.svg", buffer: Buffer.from("<svg></svg>") })),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a file over 10MB", async () => {
    await expect(
      service.saveEvidence(fakeFile({ size: 11 * 1024 * 1024, originalname: "huge.pdf" })),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a file whose content doesn't match its claimed mimetype, even when the claimed type is allowed", async () => {
    const maliciousSvg = Buffer.from("<svg onload=\"alert(document.cookie)\"></svg>");
    await expect(
      service.saveEvidence(fakeFile({ mimetype: "application/pdf", originalname: "totally-a-pdf.pdf", buffer: maliciousSvg })),
    ).rejects.toThrow(BadRequestException);
  });
});
