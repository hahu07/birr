import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@birr/db";
import { EncryptionService } from "./encryption.service";
import { envVarName, isKnownProviderField } from "./provider-fields";

function assertKnownField(provider: string, key: string): void {
  if (!isKnownProviderField(provider, key)) {
    throw new BadRequestException(`Unknown provider field "${provider}.${key}".`);
  }
}

function maskValue(value: string): string {
  const last4 = value.slice(-4);
  return value.length <= 4 ? "•".repeat(value.length) : `${"•".repeat(8)}${last4}`;
}

export interface CredentialStatus {
  configured: boolean;
  maskedPreview: string | null;
  updatedAt: Date | null;
  updatedByUser: { id: string; fullName: string } | null;
}

/**
 * Single resolution point every provider adapter calls instead of
 * reading process.env directly: a ProviderCredential row (set through
 * the Ops Console's Platform Settings page) overrides the env var when
 * present; its absence means "keep using the env var," not "unconfigured"
 * — this is what makes the rollout safe for the existing env-var-only
 * dev setup.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly encryption: EncryptionService) {}

  async get(provider: string, key: string): Promise<string | undefined> {
    const row = await prisma.providerCredential.findUnique({ where: { provider_key: { provider, key } } });
    if (row) return this.encryption.decrypt(row.encryptedValue);
    return process.env[envVarName(provider, key)] || undefined;
  }

  /**
   * For the dashboard listing only — deliberately does NOT fall back to
   * the env var here. Showing an env-var value as if it were "configured
   * through the dashboard" would misrepresent where it actually lives
   * and who (if anyone) is accountable for it via updatedByUser.
   */
  async getStatus(provider: string, key: string): Promise<CredentialStatus> {
    const row = await prisma.providerCredential.findUnique({
      where: { provider_key: { provider, key } },
      include: { updatedByUser: { select: { id: true, fullName: true } } },
    });
    if (!row) {
      return { configured: false, maskedPreview: null, updatedAt: null, updatedByUser: null };
    }
    const plaintext = this.encryption.decrypt(row.encryptedValue);
    return {
      configured: true,
      maskedPreview: maskValue(plaintext),
      updatedAt: row.updatedAt,
      updatedByUser: row.updatedByUser,
    };
  }

  /**
   * Encrypts and upserts, audit-logging that the field changed — never
   * the plaintext or ciphertext itself (AuditLog.before/after have no
   * field-level redaction of their own, see AuditLogsService).
   */
  async set(provider: string, key: string, value: string, actorUserId: string): Promise<void> {
    assertKnownField(provider, key);
    const encryptedValue = this.encryption.encrypt(value);
    await prisma.$transaction(async (tx) => {
      await tx.providerCredential.upsert({
        where: { provider_key: { provider, key } },
        create: { provider, key, encryptedValue, updatedByUserId: actorUserId },
        update: { encryptedValue, updatedByUserId: actorUserId },
      });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "provider_credential.updated",
          entityType: "ProviderCredential",
          entityId: `${provider}.${key}`,
          after: { provider, key, changed: true } as any,
        },
      });
    });
  }

  /** Removes the DB override, reverting to the env-var fallback (if any). */
  async clear(provider: string, key: string, actorUserId: string): Promise<void> {
    assertKnownField(provider, key);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.providerCredential.findUnique({ where: { provider_key: { provider, key } } });
      if (!existing) return;
      await tx.providerCredential.delete({ where: { provider_key: { provider, key } } });
      await tx.auditLog.create({
        data: {
          actorType: "birr_staff",
          actorUserId,
          action: "provider_credential.cleared",
          entityType: "ProviderCredential",
          entityId: `${provider}.${key}`,
        },
      });
    });
  }
}
