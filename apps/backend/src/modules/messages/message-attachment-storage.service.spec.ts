import { BadRequestException } from "@nestjs/common";
import { unlink } from "fs/promises";
import * as path from "path";
import { MessageAttachmentStorageService } from "./message-attachment-storage.service";

function fakeFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: "attachments",
    originalname: "document.pdf",
    encoding: "7bit",
    mimetype: "application/pdf",
    buffer: Buffer.from("fixture content"),
    size: Buffer.from("fixture content").length,
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
      service.saveAttachment(fakeFile({ mimetype: "image/svg+xml", originalname: "logo.svg" })),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a file over 10MB", async () => {
    await expect(
      service.saveAttachment(fakeFile({ size: 11 * 1024 * 1024, originalname: "huge.pdf" })),
    ).rejects.toThrow(BadRequestException);
  });
});
