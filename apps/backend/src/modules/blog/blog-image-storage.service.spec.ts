import { BadRequestException } from "@nestjs/common";
import { readFile, rm } from "fs/promises";
import * as path from "path";
import sharp from "sharp";
import { BlogImageStorageService } from "./blog-image-storage.service";

describe("BlogImageStorageService", () => {
  const service = new BlogImageStorageService();
  const written: string[] = [];
  afterAll(() => Promise.all(written.map((f) => rm(f, { force: true }))));

  const upload = (buffer: Buffer, size = buffer.length) => ({ buffer, size, originalname: "x" }) as Express.Multer.File;
  const fileFor = (url: string) => path.join(__dirname, "..", "..", "..", "uploads", "blog-images", path.basename(url));

  it("stores a re-encoded, metadata-free JPEG under /uploads/blog-images/ — GPS from a phone photo never goes public", async () => {
    const withGps = await sharp({ create: { width: 200, height: 120, channels: 3, background: "#2a7" } })
      .withExif({ IFD0: { Make: "SecretPhoneCo" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 0/1 0/1" } })
      .jpeg()
      .toBuffer();
    const { url } = await service.saveImage(upload(withGps));
    written.push(fileFor(url));
    expect(url).toContain("/uploads/blog-images/");
    expect(url.endsWith(".jpg")).toBe(true);

    const stored = await readFile(fileFor(url));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(Buffer.from("SecretPhoneCo"))).toBe(false);
  });

  it("rejects an SVG, a spoofed image, and an oversize file", async () => {
    await expect(service.saveImage(upload(Buffer.from("<svg><script>alert(1)</script></svg>")))).rejects.toThrow(/PNG, JPEG, or WebP/);
    const pngHeaderOnly = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await expect(service.saveImage(upload(pngHeaderOnly))).rejects.toThrow(/couldn't be read/);
    const real = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(service.saveImage(upload(real, 9 * 1024 * 1024))).rejects.toThrow(BadRequestException);
  });
});
