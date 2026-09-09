import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import * as path from "path";

// Same plain-local-disk convention as MessageAttachmentStorageService
// (apps/backend/src/modules/messages/message-attachment-storage.service.ts)
// — see that file's own comment on why an S3/R2-style adapter would be
// premature with only one storage backend in play. Already covered by
// main.ts's existing `app.use("/uploads", express.static(...))` mount.
// dist/modules/ai-agents -> apps/backend/uploads/bashir-generated-images.
const UPLOAD_DIR = path.join(__dirname, "..", "..", "..", "uploads", "bashir-generated-images");

/**
 * No MIME-sniffing/allowlist validation here unlike
 * MessageAttachmentStorageService — that guards against an arbitrary
 * user-uploaded file; these bytes always come from our own
 * ImageProviderAdapter.generate() calls, not user input.
 */
@Injectable()
export class GeneratedImageStorageService {
  async save(buffer: Buffer): Promise<{ url: string }> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}.png`;
    await writeFile(path.join(UPLOAD_DIR, filename), buffer);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/bashir-generated-images/${filename}` };
  }
}
