import { BadRequestException } from "@nestjs/common";
import { readFile, rm } from "fs/promises";
import * as path from "path";
import sharp from "sharp";
import { ImpactPhotoStorageService, MAX_DIMENSION } from "./impact-photo-storage.service";

describe("ImpactPhotoStorageService", () => {
  const service = new ImpactPhotoStorageService();
  const written: string[] = [];

  afterAll(async () => {
    await Promise.all(written.map((f) => rm(f, { force: true })));
  });

  const asUpload = (buffer: Buffer) => ({ buffer, size: buffer.length }) as Express.Multer.File;
  const fileFor = (url: string) => path.join(__dirname, "..", "..", "..", "uploads", "impact-photos", path.basename(url));
  async function save(buffer: Buffer) {
    const { url } = await service.savePhoto(asUpload(buffer));
    written.push(fileFor(url));
    return readFile(fileFor(url));
  }

  // A 300x200 JPEG the way a phone makes one: carrying a GPS position, a
  // camera model, and a rotate-90° orientation flag.
  const phonePhoto = () =>
    sharp({ create: { width: 300, height: 200, channels: 3, background: "#2a7" } })
      .withExif({
        IFD0: { Make: "SecretPhoneCo" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "8/1 30/1 0/1" },
      })
      .jpeg()
      .withMetadata({ orientation: 6 }) // withExif() alone normalises Orientation back to 1
      .toBuffer();

  it("strips all metadata (GPS, camera) from the stored file", async () => {
    const input = await phonePhoto();
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really does carry EXIF

    const stored = await save(input);
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(stored.includes(Buffer.from("SecretPhoneCo"))).toBe(false);
    expect(stored.includes(Buffer.from("GPS"))).toBe(false);
    expect(meta.format).toBe("jpeg");
  });

  it("bakes the camera rotation into the pixels so a portrait photo isn't shown sideways once the flag is gone", async () => {
    const input = await phonePhoto();
    expect((await sharp(input).metadata()).orientation).toBe(6); // the fixture really is flagged "rotate 90°"
    const stored = await save(input);
    const meta = await sharp(stored).metadata();
    // 300x200 landscape + "rotate 90°" flag → stored as 200x300 portrait, with no orientation flag left.
    expect([meta.width, meta.height]).toEqual([200, 300]);
    expect(meta.orientation).toBeUndefined();
  });

  it("shrinks a large image to the maximum dimension and never enlarges a small one", async () => {
    const big = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: "#fff" } }).png().toBuffer();
    const bigMeta = await sharp(await save(big)).metadata();
    expect(Math.max(bigMeta.width!, bigMeta.height!)).toBe(MAX_DIMENSION);

    const small = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#fff" } }).png().toBuffer();
    const smallMeta = await sharp(await save(small)).metadata();
    expect([smallMeta.width, smallMeta.height]).toEqual([64, 48]);
  });

  it("rejects an SVG (script risk), plain text, and a file with a spoofed image header that isn't decodable", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(service.savePhoto(asUpload(svg))).rejects.toThrow(/PNG, JPEG, or WebP/);
    await expect(service.savePhoto(asUpload(Buffer.from("hello world")))).rejects.toThrow(BadRequestException);

    const pngMagicOnly = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a png")]);
    await expect(service.savePhoto(asUpload(pngMagicOnly))).rejects.toThrow(/couldn't be read/);
  });

  it("rejects an upload over the size limit", async () => {
    const jpeg = await phonePhoto();
    await expect(service.savePhoto({ buffer: jpeg, size: 9 * 1024 * 1024 } as Express.Multer.File)).rejects.toThrow(/8MB/);
  });
});
