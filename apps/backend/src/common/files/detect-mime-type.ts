/**
 * Content-based (magic-byte) MIME detection for the small, fixed set of
 * upload formats this codebase accepts (LogoStorageService,
 * MessageAttachmentStorageService). 2026-08-30 security audit fix — both
 * services previously trusted Express.Multer.File#mimetype, which is
 * read straight from the client-supplied Content-Type header on the
 * multipart form part and is trivially spoofable (e.g. an SVG carrying
 * inline <script>, uploaded with a claimed "image/png" Content-Type,
 * would have sailed through the allowlist check untouched). Returns
 * null for anything that doesn't match one of these signatures — callers
 * treat that as "reject", the same as an unrecognized extension before
 * this fix.
 */
export function detectMimeType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }

  return null;
}
