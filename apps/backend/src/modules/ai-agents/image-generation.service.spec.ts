import { ServiceUnavailableException } from "@nestjs/common";
import { ImageGenerationService } from "./image-generation.service";
import { SettingsService } from "../../common/settings/settings.service";
import { GeneratedImageStorageService } from "./generated-image-storage.service";

function fakeSettings(activeProvider: string | undefined): SettingsService {
  return { get: async () => activeProvider } as unknown as SettingsService;
}

function fakeStorage(): GeneratedImageStorageService {
  return { save: async (buffer: Buffer) => ({ url: `https://cdn.example.test/${buffer.toString()}.png` }) } as unknown as GeneratedImageStorageService;
}

function fakeAdapter(provider: string, buffer: Buffer): any {
  return { provider, generate: jest.fn(async () => buffer) };
}

describe("ImageGenerationService", () => {
  test("dispatches to the openai adapter when it's the active provider", async () => {
    const openAiBuffer = Buffer.from("openai-output");
    const openAi = fakeAdapter("openai", openAiBuffer);
    const replicate = fakeAdapter("replicate", Buffer.from("replicate-output"));

    const service = new ImageGenerationService(fakeSettings("openai"), fakeStorage(), openAi, replicate);
    const result = await service.generate("a waqf");

    expect(openAi.generate).toHaveBeenCalledWith("a waqf");
    expect(replicate.generate).not.toHaveBeenCalled();
    expect(result.url).toContain("openai-output");
  });

  test("dispatches to the replicate adapter when it's the active provider — proves the plugin design isn't hardcoded to one vendor", async () => {
    const openAi = fakeAdapter("openai", Buffer.from("openai-output"));
    const replicateBuffer = Buffer.from("replicate-output");
    const replicate = fakeAdapter("replicate", replicateBuffer);

    const service = new ImageGenerationService(fakeSettings("replicate"), fakeStorage(), openAi, replicate);
    const result = await service.generate("a waqf");

    expect(replicate.generate).toHaveBeenCalledWith("a waqf");
    expect(openAi.generate).not.toHaveBeenCalled();
    expect(result.url).toContain("replicate-output");
  });

  test("throws a clear error when no active provider is configured", async () => {
    const service = new ImageGenerationService(
      fakeSettings(undefined),
      fakeStorage(),
      fakeAdapter("openai", Buffer.from("x")),
      fakeAdapter("replicate", Buffer.from("x")),
    );
    await expect(service.generate("a waqf")).rejects.toThrow(ServiceUnavailableException);
  });

  test("throws a clear error when the configured provider name doesn't match any registered adapter", async () => {
    const service = new ImageGenerationService(
      fakeSettings("dall-e-typo"),
      fakeStorage(),
      fakeAdapter("openai", Buffer.from("x")),
      fakeAdapter("replicate", Buffer.from("x")),
    );
    await expect(service.generate("a waqf")).rejects.toThrow('active: "dall-e-typo"');
  });
});
