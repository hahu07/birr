import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ImageProviderAdapter } from "./image-provider.interface";
import { SettingsService } from "../../../common/settings/settings.service";

interface OpenAiImagesResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
}

/**
 * Hand-rolled `fetch` against OpenAI's REST API — no OpenAI SDK
 * dependency, same "no official SDK, hand-authored fetch" style this
 * codebase already uses for Paystack (see paystack.adapter.ts's own
 * comment). Handles both response shapes OpenAI's images endpoint can
 * return (a hosted url, or an inline b64_json) rather than assuming
 * one — this varies by model/config and isn't worth guessing at.
 */
@Injectable()
export class OpenAiImageAdapter implements ImageProviderAdapter {
  readonly provider = "openai";
  private readonly baseUrl = "https://api.openai.com/v1/images/generations";

  constructor(private readonly settings: SettingsService) {}

  async generate(prompt: string): Promise<Buffer> {
    const apiKey = await this.settings.get("openai", "API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException("OpenAI image generation isn't configured (no API key set).");
    }

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-image-1.5", prompt, n: 1, size: "1024x1024" }),
    });
    const body = (await res.json().catch(() => null)) as OpenAiImagesResponse | null;
    if (!res.ok) {
      throw new ServiceUnavailableException(`OpenAI image generation failed: ${body?.error?.message ?? res.statusText}`);
    }

    const image = body?.data?.[0];
    if (image?.b64_json) {
      return Buffer.from(image.b64_json, "base64");
    }
    if (image?.url) {
      const imageRes = await fetch(image.url);
      if (!imageRes.ok) {
        throw new ServiceUnavailableException("OpenAI returned an image URL that couldn't be fetched.");
      }
      return Buffer.from(await imageRes.arrayBuffer());
    }
    throw new ServiceUnavailableException("OpenAI's response had no image data.");
  }
}
