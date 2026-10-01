import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { detectMimeType } from "../../common/files/detect-mime-type";
import { FileStorageService } from "../../common/storage/file-storage.service";

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

/** Folder under uploads/ (or the bucket) — served back at /uploads/vault-documents/<filename>; see FileStorageService. */
const FOLDER = "vault-documents";

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
  constructor(private readonly storage: FileStorageService = new FileStorageService()) {}

  async saveDocument(file: Express.Multer.File): Promise<{ url: string }> {
    const detectedMimeType = detectMimeType(file.buffer);
    const extension = detectedMimeType ? ALLOWED_MIME_TYPES[detectedMimeType] : undefined;
    if (!extension) {
      throw new BadRequestException(`"${file.originalname}" must be a PDF, PNG, JPEG, or WebP file.`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException(`"${file.originalname}" must be 10MB or smaller.`);
    }
    const filename = `${randomUUID()}.${extension}`;
    await this.storage.put(FOLDER, filename, file.buffer);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/vault-documents/${filename}` };
  }
}
