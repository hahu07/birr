import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ImageProviderAdapter } from "./image-provider.interface";
import { SettingsService } from "../../../common/settings/settings.service";

// Pinned Flux model version — Replicate versions models by a content
// hash, not a floating tag, so a specific version is required for a
// reproducible request. black-forest-labs/flux-schnell, a fast/cheap
// Flux variant well suited to draft marketing content (see this
// adapter's own economics vs. flux-pro for a higher-quality/slower/
// pricier option later, a one-line change).
const MODEL_VERSION = "f2ab8a5bfe79f02f0789a146cf5e73d2a4ff2684a98c2b303d1e1ff3814271db";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30000;

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string[] | string;
  urls: { get: string };
  error?: string;
}

function sleep(ms: number): Promise<void> {
  // .unref() so this timer alone never keeps the process (or a Jest
  // worker in tests) alive — it still fires and resolves normally in
  // the meantime, this only affects whether Node considers it a reason
  // to stay running.
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/**
 * Hand-rolled `fetch` against Replicate's REST API — same "no official
 * SDK" style as OpenAiImageAdapter/paystack.adapter.ts. Replicate's own
 * API is async (create a prediction, poll until it resolves) — that
 * detail stays entirely inside this adapter; callers just await
 * generate() like any other provider.
 */
@Injectable()
export class ReplicateImageAdapter implements ImageProviderAdapter {
  readonly provider = "replicate";

  constructor(private readonly settings: SettingsService) {}

  async generate(prompt: string): Promise<Buffer> {
    const apiKey = await this.settings.get("replicate", "API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException("Replicate image generation isn't configured (no API key set).");
    }

    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ version: MODEL_VERSION, input: { prompt } }),
    });
    let prediction = (await createRes.json().catch(() => null)) as ReplicatePrediction | null;
    if (!createRes.ok || !prediction) {
      throw new ServiceUnavailableException(`Replicate image generation failed to start: ${prediction?.error ?? createRes.statusText}`);
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (prediction && prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
      if (Date.now() > deadline) {
        throw new ServiceUnavailableException("Replicate image generation timed out.");
      }
      await sleep(POLL_INTERVAL_MS);
      const pollRes = await fetch(prediction.urls.get, { headers: { Authorization: `Bearer ${apiKey}` } });
      prediction = (await pollRes.json().catch(() => null)) as ReplicatePrediction | null;
    }

    if (!prediction || prediction.status !== "succeeded") {
      throw new ServiceUnavailableException(`Replicate image generation failed: ${prediction?.error ?? "unknown error"}`);
    }

    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) {
      throw new ServiceUnavailableException("Replicate's response had no image output.");
    }
    const imageRes = await fetch(outputUrl);
    if (!imageRes.ok) {
      throw new ServiceUnavailableException("Replicate returned an image URL that couldn't be fetched.");
    }
    return Buffer.from(await imageRes.arrayBuffer());
  }
}
