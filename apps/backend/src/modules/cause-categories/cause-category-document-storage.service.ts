import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";
import { detectMimeType } from "../../common/files/detect-mime-type";

// Same allowlist/reasoning as VaultDocumentStorageService — a project
// plan template is almost always a PDF, but the image formats stay
// available for a scanned document. No SVG, same inline-<script>
// exclusion as every other upload path in this codebase.
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MAX_SIZE_BYTES = 10 * 1024 * 1024;

const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads", "cause-category-documents");

/**
 * CauseCategory.projectPlanFileUrl storage — a template document staff
 * can attach once per catalog category (POST
 * /cause-categories/:id/project-plan-file), same buffered-in-memory-
 * until-validated shape as VaultDocumentStorageService, but not that
 * service's audience: see the schema field's own comment for why this
 * is staff reference material, never shown to a donor.
 */
@Injectable()
export class CauseCategoryDocumentStorageService {
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
    return { url: `${backendUrl}/uploads/cause-category-documents/${filename}` };
  }
}
