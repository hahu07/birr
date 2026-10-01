import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { detectMimeType } from "../../common/files/detect-mime-type";
import { FileStorageService } from "../../common/storage/file-storage.service";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  // Deliberately no image/svg+xml — an uploaded SVG can carry inline
  // <script>, making this the one image format that's also an XSS
  // vector if ever served with a permissive Content-Type.
};

// Exported so the controller's FileInterceptor can enforce the same cap
// at the multer layer (see founders.controller.ts) — without a multer
// `limits.fileSize`, the whole request body gets buffered into memory
// before this service's own size check ever runs, so the check alone
// doesn't bound memory use under a large/repeated upload.
export const MAX_SIZE_BYTES = 2 * 1024 * 1024;

// dist/modules/foundations -> apps/backend/uploads/logos. Kept as a
// plain local-disk write, not an S3/R2-style adapter — there's only one
// storage backend today (unlike payments/email/WhatsApp, which had
// three real providers from day one), so an interface here would be
// premature. Swapping to real object storage later is a single-file
// change.
/** Folder under uploads/ (or the bucket) — served back at /uploads/logos/<filename>; see FileStorageService. */
const FOLDER = "logos";

/**
 * Foundation logo uploads (POST /founders/establish). Files are
 * memory-buffered by multer's default storage (no `dest`/`storage`
 * option configured on the FileInterceptor), so file.buffer is what
 * gets written here — never touches disk before validation passes.
 */
@Injectable()
export class LogoStorageService {
  constructor(private readonly storage: FileStorageService = new FileStorageService()) {}

  async saveLogo(file: Express.Multer.File): Promise<{ url: string }> {
    // Decided by the file's actual bytes, not the client-supplied
    // mimetype — see detectMimeType's own comment (2026-08-30 security
    // audit fix).
    const detectedMimeType = detectMimeType(file.buffer);
    const extension = detectedMimeType ? ALLOWED_MIME_TYPES[detectedMimeType] : undefined;
    if (!extension) {
      throw new BadRequestException("Logo must be a PNG, JPEG, or WebP image.");
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException("Logo must be 2MB or smaller.");
    }
    const filename = `${randomUUID()}.${extension}`;
    await this.storage.put(FOLDER, filename, file.buffer);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/logos/${filename}` };
  }
}
