import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { detectMimeType } from "../../common/files/detect-mime-type";
import { reencodeImage } from "../../common/files/reencode-image";
import { FileStorageService } from "../../common/storage/file-storage.service";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_BLOG_IMAGE_BYTES = 8 * 1024 * 1024;

/** Folder under uploads/ (or the bucket) — served back at /uploads/blog-images/<filename>; see FileStorageService. */
const FOLDER = "blog-images";

/**
 * Images for blog articles — a cover photo, or a picture placed inside the
 * article text. Public content, so every file is a fresh, metadata-free
 * re-encode of what was uploaded (see reencodeImage: GPS stripped, rotation
 * fixed, resized). Type is decided from the file's bytes, never the client's
 * Content-Type header; no SVG (inline-script risk).
 */
@Injectable()
export class BlogImageStorageService {
  constructor(private readonly storage: FileStorageService = new FileStorageService()) {}

  async saveImage(file: Express.Multer.File): Promise<{ url: string }> {
    const detected = detectMimeType(file.buffer);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
      throw new BadRequestException("Image must be a PNG, JPEG, or WebP file.");
    }
    if (file.size > MAX_BLOG_IMAGE_BYTES) {
      throw new BadRequestException("Image must be 8MB or smaller.");
    }
    const output = await reencodeImage(file.buffer);
    const filename = `${randomUUID()}.jpg`;
    await this.storage.put(FOLDER, filename, output);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/blog-images/${filename}` };
  }
}
