import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

/**
 * AES-256-GCM at-rest encryption for ProviderCredential.encryptedValue.
 * No encryption utility existed anywhere in this repo before this — kept
 * deliberately minimal (no key rotation/versioning) since there's a
 * single key today; add a key-id prefix to the packed format if/when a
 * second key generation is ever needed.
 */
@Injectable()
export class EncryptionService {
  // Lazy, same pattern as every provider adapter's client construction —
  // the backend must still boot with SETTINGS_ENCRYPTION_KEY unset; only
  // an actual encrypt/decrypt call fails, with a clear message.
  private getKey(): Buffer {
    const raw = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error("SETTINGS_ENCRYPTION_KEY is not configured.");
    }
    const key = Buffer.from(raw, "hex");
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `SETTINGS_ENCRYPTION_KEY must be ${KEY_LENGTH_BYTES} bytes (${KEY_LENGTH_BYTES * 2} hex chars) — got ${key.length} bytes.`,
      );
    }
    return key;
  }

  /** Returns "<ivB64>.<authTagB64>.<ciphertextB64>". */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
  }

  /** Throws if the packed format is malformed or authentication fails (tampered/wrong key). */
  decrypt(packed: string): string {
    const parts = packed.split(".");
    if (parts.length !== 3) {
      throw new Error("Malformed encrypted value.");
    }
    const [ivB64, authTagB64, ciphertextB64] = parts;
    const iv = Buffer.from(ivB64!, "base64");
    const authTag = Buffer.from(authTagB64!, "base64");
    const ciphertext = Buffer.from(ciphertextB64!, "base64");

    const decipher = createDecipheriv(ALGORITHM, this.getKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  }
}
