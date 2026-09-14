import { BadRequestException } from "@nestjs/common";
import { unlink } from "fs/promises";
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

  test("saves an allowed image", async () => {
    const realPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const result = await service.saveEvidence(fakeFile({ mimetype: "image/png", originalname: "site-photo.png", buffer: realPng }));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/vault-milestone-evidence/");
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
