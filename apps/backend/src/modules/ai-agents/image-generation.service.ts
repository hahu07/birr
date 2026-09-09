import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { SettingsService } from "../../common/settings/settings.service";
import { GeneratedImageStorageService } from "./generated-image-storage.service";
import { ImageProviderAdapter } from "./image-providers/image-provider.interface";
import { OpenAiImageAdapter } from "./image-providers/openai-image.adapter";
import { ReplicateImageAdapter } from "./image-providers/replicate-image.adapter";

/**
 * Same "one interface, one adapter per vendor, a Map selected at
 * runtime" shape as ContributionsService
 * (apps/backend/src/modules/contributions/contributions.service.ts) —
 * the one difference is the provider isn't chosen per-call by the
 * caller, it's a platform-wide switch (image_generation.ACTIVE_PROVIDER
 * in Platform Settings), since Bashir has no reason to know or care
 * which vendor is behind the scenes.
 */
@Injectable()
export class ImageGenerationService {
  private readonly adapters: Map<string, ImageProviderAdapter>;

  constructor(
    private readonly settings: SettingsService,
    private readonly storage: GeneratedImageStorageService,
    openAiAdapter: OpenAiImageAdapter,
    replicateAdapter: ReplicateImageAdapter,
  ) {
    this.adapters = new Map<string, ImageProviderAdapter>([
      ["openai", openAiAdapter],
      ["replicate", replicateAdapter],
    ]);
  }

  async generate(prompt: string): Promise<{ url: string }> {
    const active = await this.settings.get("image_generation", "ACTIVE_PROVIDER");
    const adapter = active ? this.adapters.get(active) : undefined;
    if (!adapter) {
      throw new ServiceUnavailableException(
        `No image provider configured (active: "${active ?? "none"}"). Set image_generation.ACTIVE_PROVIDER to "openai" or "replicate" in Platform Settings.`,
      );
    }
    const buffer = await adapter.generate(prompt);
    return this.storage.save(buffer);
  }
}
