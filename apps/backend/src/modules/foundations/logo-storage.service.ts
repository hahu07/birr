import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  // Deliberately no image/svg+xml — an uploaded SVG can carry inline
  // <script>, making this the one image format that's also an XSS
  // vector if ever served with a permissive Content-Type.
};

const MAX_SIZE_BYTES = 2 * 1024 * 1024;

// dist/modules/foundations -> apps/backend/uploads/logos. Kept as a
// plain local-disk write, not an S3/R2-style adapter — there's only one
// storage backend today (unlike payments/email/WhatsApp, which had
// three real providers from day one), so an interface here would be
// premature. Swapping to real object storage later is a single-file
// change.
const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads", "logos");

/**
 * Foundation logo uploads (POST /founders/establish). Files are
 * memory-buffered by multer's default storage (no `dest`/`storage`
 * option configured on the FileInterceptor), so file.buffer is what
 * gets written here — never touches disk before validation passes.
 */
@Injectable()
export class LogoStorageService {
  async saveLogo(file: Express.Multer.File): Promise<{ url: string }> {
    const extension = ALLOWED_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException("Logo must be a PNG, JPEG, or WebP image.");
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException("Logo must be 2MB or smaller.");
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(path.join(UPLOAD_DIR, filename), file.buffer);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/logos/${filename}` };
  }
}
