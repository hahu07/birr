import { BadRequestException } from "@nestjs/common";
import { unlink } from "fs/promises";
import * as path from "path";
import { VaultDocumentStorageService } from "./vault-document-storage.service";

// Real magic bytes — detectMimeType decides off file content, not the
// client-supplied mimetype field, same convention as every other
// upload spec in this codebase.
const REAL_PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("fixture content")]);

function fakeFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: "report",
    originalname: "feasibility-study.pdf",
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

describe("VaultDocumentStorageService", () => {
  const service = new VaultDocumentStorageService();
  const savedUrls: string[] = [];

  afterAll(async () => {
    const uploadDir = path.join(__dirname, "..", "..", "..", "uploads", "vault-documents");
    for (const url of savedUrls) {
      const filename = url.split("/").pop()!;
      await unlink(path.join(uploadDir, filename)).catch(() => {});
    }
  });

  test("saves an allowed PDF and returns a URL under /uploads/vault-documents/", async () => {
    const result = await service.saveDocument(fakeFile({}));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/vault-documents/");
  });

  test("rejects a disallowed mimetype (e.g. SVG)", async () => {
    await expect(
      service.saveDocument(fakeFile({ mimetype: "image/svg+xml", originalname: "logo.svg", buffer: Buffer.from("<svg></svg>") })),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a file over 10MB", async () => {
    await expect(service.saveDocument(fakeFile({ size: 11 * 1024 * 1024, originalname: "huge.pdf" }))).rejects.toThrow(
      BadRequestException,
    );
  });

  test("rejects a file whose content doesn't match its claimed mimetype, even when the claimed type is allowed", async () => {
    const maliciousSvg = Buffer.from("<svg onload=\"alert(document.cookie)\"></svg>");
    await expect(
      service.saveDocument(fakeFile({ mimetype: "application/pdf", originalname: "totally-a-pdf.pdf", buffer: maliciousSvg })),
    ).rejects.toThrow(BadRequestException);
  });
});
