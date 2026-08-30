import { BadRequestException } from "@nestjs/common";
import { unlink } from "fs/promises";
import * as path from "path";
import { MessageAttachmentStorageService } from "./message-attachment-storage.service";

// Real magic bytes — 2026-08-30 security audit fix made saveAttachment()
// decide the allowlist off file content, not the client-supplied
// mimetype field, so fixtures need to actually match to exercise the
// "legitimate file" path.
const REAL_PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("fixture content")]);

function fakeFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: "attachments",
    originalname: "document.pdf",
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

describe("MessageAttachmentStorageService", () => {
  const service = new MessageAttachmentStorageService();
  const savedUrls: string[] = [];

  afterAll(async () => {
    // Real local-disk writes (same as production) — clean up what this
    // spec actually wrote, mirroring the "no file storage spec exists
    // yet in this codebase" gap this file is the first to fill.
    const uploadDir = path.join(__dirname, "..", "..", "..", "uploads", "message-attachments");
    for (const url of savedUrls) {
      const filename = url.split("/").pop()!;
      await unlink(path.join(uploadDir, filename)).catch(() => {});
    }
  });

  test("saves an allowed PDF and returns a URL under /uploads/message-attachments/", async () => {
    const result = await service.saveAttachment(fakeFile({}));
    savedUrls.push(result.url);
    expect(result.url).toContain("/uploads/message-attachments/");
    expect(result.fileName).toBe("document.pdf");
    expect(result.mimeType).toBe("application/pdf");
  });

  test("rejects a disallowed mimetype (e.g. SVG)", async () => {
    await expect(
      service.saveAttachment(
        fakeFile({ mimetype: "image/svg+xml", originalname: "logo.svg", buffer: Buffer.from("<svg></svg>") }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a file over 10MB", async () => {
    await expect(
      service.saveAttachment(fakeFile({ size: 11 * 1024 * 1024, originalname: "huge.pdf" })),
    ).rejects.toThrow(BadRequestException);
  });

  // 2026-08-30 security audit fix — the client-supplied mimetype field
  // (read straight from the multipart Content-Type header) used to be
  // trusted outright. A malicious upload — e.g. an SVG carrying inline
  // <script>, mislabeled as a trusted type — would have sailed through.
  test("rejects a file whose content doesn't match its claimed mimetype, even when the claimed type is allowed", async () => {
    const maliciousSvg = Buffer.from("<svg onload=\"alert(document.cookie)\"></svg>");
    await expect(
      service.saveAttachment(
        fakeFile({ mimetype: "application/pdf", originalname: "totally-a-pdf.pdf", buffer: maliciousSvg }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("accepts real content matching an allowed type even when the client's mimetype label is wrong", async () => {
    const realPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const result = await service.saveAttachment(
      fakeFile({ mimetype: "application/octet-stream", originalname: "photo.png", buffer: realPng }),
    );
    savedUrls.push(result.url);
    expect(result.mimeType).toBe("image/png");
  });
});
