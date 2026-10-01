import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { detectMimeType } from "../../common/files/detect-mime-type";
import { reencodeImage, MAX_IMAGE_DIMENSION } from "../../common/files/reencode-image";
import { FileStorageService } from "../../common/storage/file-storage.service";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export { MAX_IMAGE_DIMENSION as MAX_DIMENSION };

/** Folder under uploads/ (or the bucket) — served back at /uploads/field-photos/<filename>; see FileStorageService. */
const FOLDER = "field-photos";

/**
 * Field photo uploads (see VaultFieldPhoto). The file served publicly is
 * always a fresh, metadata-free re-encode of what was uploaded — see
 * reencodeImage for exactly why. The type is decided from the file's actual
 * bytes (never the client's Content-Type header), and no SVG is accepted
 * (inline-script risk).
 */
@Injectable()
export class FieldPhotoStorageService {
  constructor(private readonly storage: FileStorageService = new FileStorageService()) {}

  async savePhoto(file: Express.Multer.File): Promise<{ url: string }> {
    const detected = detectMimeType(file.buffer);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
      throw new BadRequestException(`"${file.originalname ?? "That file"}" must be a PNG, JPEG, or WebP image.`);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`"${file.originalname ?? "That photo"}" must be 8MB or smaller.`);
    }
    const output = await reencodeImage(file.buffer);

    const filename = `${randomUUID()}.jpg`;
    await this.storage.put(FOLDER, filename, output);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/field-photos/${filename}` };
  }
}
