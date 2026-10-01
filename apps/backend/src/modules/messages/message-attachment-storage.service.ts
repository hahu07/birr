import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { detectMimeType } from "../../common/files/detect-mime-type";
import { FileStorageService } from "../../common/storage/file-storage.service";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  // Same SVG exclusion as LogoStorageService, same reason (inline
  // <script> XSS vector). No DOCX/XLSX in this first pass — broadening
  // this allowlist later is a one-line change here.
};

// Exported so the controller's FilesInterceptor can enforce the same cap
// at the multer layer (see messages.controller.ts) — see
// LogoStorageService's own comment on why the app-layer check alone
// doesn't bound memory use.
export const MAX_SIZE_BYTES = 10 * 1024 * 1024; // documents run bigger than a 2MB logo

// dist/modules/messages -> apps/backend/uploads/message-attachments.
// Same plain local-disk convention as LogoStorageService — see that
// file's own comment on why an S3/R2-style adapter would be premature
// with only one storage backend in play. Already covered by main.ts's
// existing `app.use("/uploads", express.static(...))` mount, which
// serves the whole uploads/ tree, not just uploads/logos — no main.ts
// change needed for this new subdirectory.
/** Folder under uploads/ (or the bucket) — served back at /uploads/message-attachments/<filename>; see FileStorageService. */
const FOLDER = "message-attachments";

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
  constructor(private readonly storage: FileStorageService = new FileStorageService()) {}

  async saveAttachment(file: Express.Multer.File): Promise<SavedAttachment> {
    // Decided by the file's actual bytes, not the client-supplied
    // mimetype — see detectMimeType's own comment (2026-08-30 security
    // audit fix).
    const detectedMimeType = detectMimeType(file.buffer);
    const extension = detectedMimeType ? ALLOWED_MIME_TYPES[detectedMimeType] : undefined;
    if (!extension || !detectedMimeType) {
      throw new BadRequestException(`"${file.originalname}" must be a PDF, PNG, JPEG, or WebP file.`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException(`"${file.originalname}" must be 10MB or smaller.`);
    }
    const filename = `${randomUUID()}.${extension}`;
    await this.storage.put(FOLDER, filename, file.buffer);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return {
      fileName: file.originalname,
      mimeType: detectedMimeType,
      sizeBytes: file.size,
      url: `${backendUrl}/uploads/message-attachments/${filename}`,
    };
  }
}
