import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { detectMimeType } from "../../common/files/detect-mime-type";
import { reencodeImage } from "../../common/files/reencode-image";
import { FileStorageService } from "../../common/storage/file-storage.service";

// Same allowlist/reasoning as MessageAttachmentStorageService — a
// photo of completed work, or a written completion report, so PDF
// joins the image formats (unlike VaultCoverStorageService, which is
// images only). No SVG, same inline-<script> exclusion as every other
// upload path in this codebase.
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** Folder under uploads/ (or the bucket) — served back at /uploads/vault-milestone-evidence/<filename>; see FileStorageService. */
const FOLDER = "vault-milestone-evidence";

/**
 * Milestone evidence uploads (POST /vault-milestones/:id/evidence) —
 * staff-only, plain local-disk write, same buffered-in-memory-until-
 * validated shape as every other upload service in this codebase.
 */
@Injectable()
export class VaultMilestoneEvidenceStorageService {
  constructor(private readonly storage: FileStorageService = new FileStorageService()) {}

  async saveEvidence(file: Express.Multer.File): Promise<{ url: string }> {
    const detectedMimeType = detectMimeType(file.buffer);
    const extension = detectedMimeType ? ALLOWED_MIME_TYPES[detectedMimeType] : undefined;
    if (!extension) {
      throw new BadRequestException(`"${file.originalname}" must be a PDF, PNG, JPEG, or WebP file.`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException(`"${file.originalname}" must be 10MB or smaller.`);
    }
    // Image evidence is shown on the public vault page and the homepage's
    // impact wall, so it's re-encoded (GPS and other metadata stripped,
    // rotation fixed, resized) exactly like a field photo — see
    // reencodeImage. A PDF is stored as uploaded.
    const isPdf = detectedMimeType === "application/pdf";
    const body = isPdf ? file.buffer : await reencodeImage(file.buffer);
    const filename = `${randomUUID()}.${isPdf ? "pdf" : "jpg"}`;
    await this.storage.put(FOLDER, filename, body);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/vault-milestone-evidence/${filename}` };
  }
}
