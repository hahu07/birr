import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import { detectMimeType } from "../../common/files/detect-mime-type";

// Same allowlist/reasoning as VaultMilestoneEvidenceStorageService — a
// photo of completed work, or a written completion report.
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_SIZE_BYTES = 10 * 1024 * 1024;

const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads", "waqf-milestone-evidence");

/**
 * Milestone evidence uploads (POST /waqf-milestones/:id/evidence) —
 * staff-only, plain local-disk write, same buffered-in-memory-until-
 * validated shape as VaultMilestoneEvidenceStorageService. A separate
 * upload directory, not a shared one, matching every other pair of
 * Vault/Waqf-side storage services in this codebase (VaultCoverStorageService
 * vs Foundation's own LogoStorageService, etc.).
 */
@Injectable()
export class WaqfMilestoneEvidenceStorageService {
  async saveEvidence(file: Express.Multer.File): Promise<{ url: string }> {
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
    return { url: `${backendUrl}/uploads/waqf-milestone-evidence/${filename}` };
  }
}
