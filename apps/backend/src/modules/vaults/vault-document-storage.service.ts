import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import { detectMimeType } from "../../common/files/detect-mime-type";

// Same allowlist/reasoning as VaultMilestoneEvidenceStorageService — a
// feasibility study is almost always a PDF, but the image formats stay
// available for a scanned document. No SVG, same inline-<script>
// exclusion as every other upload path in this codebase.
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_SIZE_BYTES = 10 * 1024 * 1024;

const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads", "vault-documents");

/**
 * Vault-level supporting documents — a feasibility study, business
 * case, or needs assessment (POST /vaults/:id/feasibility-report),
 * public by design (see Vault.feasibilityReportUrl's own schema
 * comment on why this is deliberately not staff-only the way milestone
 * evidence is). Same buffered-in-memory-until-validated shape as every
 * other upload service in this codebase.
 */
@Injectable()
export class VaultDocumentStorageService {
  async saveDocument(file: Express.Multer.File): Promise<{ url: string }> {
    const detectedMimeType = detectMimeType(file.buffer);
    const extension = detectedMimeType ? ALLOWED_MIME_TYPES[detectedMimeType] : undefined;
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
    return { url: `${backendUrl}/uploads/vault-documents/${filename}` };
  }
}
