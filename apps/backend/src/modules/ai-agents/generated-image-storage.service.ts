import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { FileStorageService } from "../../common/storage/file-storage.service";

// Same plain-local-disk convention as MessageAttachmentStorageService
// (apps/backend/src/modules/messages/message-attachment-storage.service.ts)
// — see that file's own comment on why an S3/R2-style adapter would be
// premature with only one storage backend in play. Already covered by
// main.ts's existing `app.use("/uploads", express.static(...))` mount.
// dist/modules/ai-agents -> apps/backend/uploads/bashir-generated-images.
/** Folder under uploads/ (or the bucket) — served back at /uploads/bashir-generated-images/<filename>; see FileStorageService. */
const FOLDER = "bashir-generated-images";

/**
 * No MIME-sniffing/allowlist validation here unlike
 * MessageAttachmentStorageService — that guards against an arbitrary
 * user-uploaded file; these bytes always come from our own
 * ImageProviderAdapter.generate() calls, not user input.
 */
@Injectable()
export class GeneratedImageStorageService {
  constructor(private readonly storage: FileStorageService = new FileStorageService()) {}

  async save(buffer: Buffer): Promise<{ url: string }> {
    const filename = `${randomUUID()}.png`;
    await this.storage.put(FOLDER, filename, buffer);

    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
    return { url: `${backendUrl}/uploads/bashir-generated-images/${filename}` };
  }
}
