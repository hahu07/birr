import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

/** The longest side of a stored public image. Plenty for a web page; keeps files small. */
export const MAX_IMAGE_DIMENSION = 1600;
/** Refuses decompression bombs (a tiny file that expands to gigapixels). */
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Always returns a FRESH JPEG encode of the uploaded image, never the
 * uploaded bytes. Used for every image that ends up on a public page
 * (field photos, milestone evidence images):
 *  - all metadata is dropped — phone photos carry GPS coordinates, and these
 *    are pictures of real beneficiaries and project sites;
 *  - camera rotation is baked into the pixels, so a portrait shot isn't shown
 *    sideways once its EXIF orientation is gone;
 *  - it's resized and compressed, so a 12MB phone photo becomes ~200KB;
 *  - nothing that isn't a decodable image survives, which also neutralises
 *    files crafted to be valid as two formats at once.
 * Callers decide the file type from the bytes themselves first (see
 * detectMimeType) — never from the client's Content-Type header.
 */
export async function reencodeImage(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // apply EXIF orientation, then drop it
      .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }) // transparent PNGs/WebPs become white, not black, as JPEG
      .jpeg({ quality: 82 })
      .toBuffer(); // sharp writes no metadata unless asked (withMetadata / withExif)
  } catch {
    throw new BadRequestException("That file couldn't be read as an image.");
  }
}
