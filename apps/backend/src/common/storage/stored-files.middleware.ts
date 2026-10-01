import type { NextFunction, Request, Response } from "express";
import * as path from "path";
import { FileStorageService } from "./file-storage.service";

const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Express middleware that serves one /uploads/<folder>/ path from whichever
 * store is configured (local disk or the bucket) — the replacement for
 * `express.static(<dir>)` that main.ts used for every uploads folder.
 * Mount it AFTER any sign-in/ownership middleware, exactly where
 * express.static used to sit: it does no authorization of its own, so the
 * existing checks in main.ts keep guarding the private folders unchanged.
 *
 * `visibility: "public"` for folders that are public by design (logos,
 * Vault covers, ...): filenames are random UUIDs and never reused, so they
 * can be cached for a long time. "private" folders (message attachments,
 * evidence, internal documents) are never cached by shared caches.
 */
export function storedFiles(storage: FileStorageService, folder: string, visibility: "public" | "private") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      // req.path is relative to the mount point: "/<filename>".
      const filename = req.path.replace(/^\//, "");
      if (!SAFE_FILENAME.test(filename) || filename.includes("..")) {
        res.status(404).json({ message: "Not found." });
        return;
      }
      const body = await storage.get(folder, filename);
      if (!body) {
        res.status(404).json({ message: "Not found." });
        return;
      }
      res.type(path.extname(filename) || "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", visibility === "public" ? "public, max-age=31536000, immutable" : "private, no-store");
      res.send(body);
    } catch (err) {
      next(err);
    }
  };
}
