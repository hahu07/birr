import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import { detectMimeType } from "../../common/files/detect-mime-type";

// Same convention as LogoStorageService (apps/backend/src/modules/
// foundations/logo-storage.service.ts) — plain local-disk write, mime
// type decided from the file's actual bytes rather than the
// client-supplied header, no SVG (inline <script> risk if ever served
// with a permissive Content-Type).
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_SIZE_BYTES = 4 * 1024 * 1024;

const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads", "vault-covers");

/**
 * Vault cover image uploads (POST /vaults/:id/cover) — public, staff-only
 * to set. A vault's cover is meant to be shown on the public homepage's
 * "Support a cause" cards, same public-by-design posture as a Foundation
 * logo.
 */
@Injectable()
export class VaultCoverStorageService {
  async saveCover(file: Express.Multer.File): Promise<{ url: string }> {
    const detectedMimeType = detectMimeType(file.buffer);
    const extension = detectedMimeType ? ALLOWED_MIME_TYPES[detectedMimeType] : undefined;
    if (!extension) {
      throw new BadRequestException("Cover image must be a PNG, JPEG, or WebP image.");
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException("Cover image must be 4MB or smaller.");
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(path.join(UPLOAD_DIR, filename), file.buffer);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/vault-covers/${filename}` };
  }
}
