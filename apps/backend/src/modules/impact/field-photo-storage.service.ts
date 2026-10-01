import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import sharp from "sharp";
import { detectMimeType } from "../../common/files/detect-mime-type";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** The longest side of the stored image. Plenty for a homepage frame; keeps files small. */
export const MAX_DIMENSION = 1600;
/** Refuses decompression bombs (a tiny file that expands to gigapixels). */
const MAX_INPUT_PIXELS = 50_000_000;

const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads", "impact-photos");

/**
 * Impact photo uploads. Unlike the Vault cover/logo uploads (which store
 * the client's bytes as-is), the file served publicly here is ALWAYS a
 * fresh re-encode of what was uploaded:
 *  - all metadata is dropped — phone photos carry GPS coordinates, and
 *    these are pictures of real beneficiaries and project sites;
 *  - camera rotation is baked into the pixels, so a portrait shot isn't
 *    shown sideways once its EXIF orientation is gone;
 *  - it's resized and compressed, so a 12MB phone photo becomes ~200KB;
 *  - nothing that isn't a decodable image survives, which also neutralises
 *    files crafted to be valid as two formats at once.
 * The type is decided from the file's actual bytes (never the client's
 * Content-Type header), and no SVG is accepted (inline-script risk).
 */
@Injectable()
export class ImpactPhotoStorageService {
  async savePhoto(file: Express.Multer.File): Promise<{ url: string }> {
    const detected = detectMimeType(file.buffer);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
      throw new BadRequestException("Photo must be a PNG, JPEG, or WebP image.");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException("Photo must be 8MB or smaller.");
    }

    let output: Buffer;
    try {
      output = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate() // apply EXIF orientation, then drop it
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }) // transparent PNGs/WebPs become white, not black, as JPEG
        .jpeg({ quality: 82 })
        .toBuffer(); // sharp writes no metadata unless asked (withMetadata / withExif)
    } catch {
      throw new BadRequestException("That file couldn't be read as an image.");
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}.jpg`;
    await writeFile(path.join(UPLOAD_DIR, filename), output);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/impact-photos/${filename}` };
  }
}
