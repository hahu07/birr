import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  // Same SVG exclusion as LogoStorageService, same reason (inline
  // <script> XSS vector). No DOCX/XLSX in this first pass — broadening
  // this allowlist later is a one-line change here.
};

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // documents run bigger than a 2MB logo

// dist/modules/messages -> apps/backend/uploads/message-attachments.
// Same plain local-disk convention as LogoStorageService — see that
// file's own comment on why an S3/R2-style adapter would be premature
// with only one storage backend in play. Already covered by main.ts's
// existing `app.use("/uploads", express.static(...))` mount, which
// serves the whole uploads/ tree, not just uploads/logos — no main.ts
// change needed for this new subdirectory.
const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads", "message-attachments");

export interface SavedAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

/**
 * Message attachments (POST /messages). Same memory-buffered-by-multer
 * shape as LogoStorageService — files never touch disk before
 * validation passes.
 */
@Injectable()
export class MessageAttachmentStorageService {
  async saveAttachment(file: Express.Multer.File): Promise<SavedAttachment> {
    const extension = ALLOWED_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(`"${file.originalname}" must be a PDF, PNG, JPEG, or WebP file.`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException(`"${file.originalname}" must be 10MB or smaller.`);
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(path.join(UPLOAD_DIR, filename), file.buffer);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return {
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      url: `${backendUrl}/uploads/message-attachments/${filename}`,
    };
  }
}
