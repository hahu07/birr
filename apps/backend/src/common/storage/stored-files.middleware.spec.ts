import type { Request, Response } from "express";
import { FileStorageService } from "./file-storage.service";
import { storedFiles } from "./stored-files.middleware";

function fakeRes() {
  const res: any = { headers: {} as Record<string, string>, statusCode: 200, body: undefined as unknown };
  res.type = (t: string) => ((res.contentType = t), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.send = (b: unknown) => ((res.body = b), res);
  return res as Response & { headers: Record<string, string>; contentType?: string; statusCode: number; body: unknown };
}
const req = (path: string, method = "GET") => ({ path, method }) as Request;

describe("storedFiles", () => {
  const files = new Map([["logos/a.png", Buffer.from("PNGDATA")], ["message-attachments/b.pdf", Buffer.from("PDFDATA")]]);
  const storage = new FileStorageService({
    put: async () => undefined,
    get: async (folder, name) => files.get(`${folder}/${name}`) ?? null,
  });

  it("serves a stored file with the right type, nosniff, and long public caching for public folders", async () => {
    const res = fakeRes();
    await storedFiles(storage, "logos", "public")(req("/a.png"), res, jest.fn());
    expect(res.body?.toString()).toBe("PNGDATA");
    expect(res.contentType).toBe(".png");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Cache-Control"]).toMatch(/public.*immutable/);
  });

  it("never lets shared caches keep a private folder's files", async () => {
    const res = fakeRes();
    await storedFiles(storage, "message-attachments", "private")(req("/b.pdf"), res, jest.fn());
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("404s a missing file, and any traversal or odd filename, without touching storage for the latter", async () => {
    const get = jest.spyOn(storage, "get");
    for (const bad of ["/missing.png", "/../secret.png", "/a/b.png", "/..", "/%2e%2e/x.png", "/.hidden"]) {
      const res = fakeRes();
      await storedFiles(storage, "logos", "public")(req(bad), res, jest.fn());
      expect(res.statusCode).toBe(404);
    }
    expect(get).toHaveBeenCalledTimes(1); // only "/missing.png" was a plausible filename
  });

  it("passes non-GET requests through, and forwards storage errors to Express", async () => {
    const next = jest.fn();
    await storedFiles(storage, "logos", "public")(req("/a.png", "POST"), fakeRes(), next);
    expect(next).toHaveBeenCalledWith();

    const failing = new FileStorageService({ put: async () => undefined, get: async () => { throw new Error("bucket down"); } });
    const next2 = jest.fn();
    await storedFiles(failing, "logos", "public")(req("/a.png"), fakeRes(), next2);
    expect(next2.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
