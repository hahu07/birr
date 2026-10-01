// Must be the literal first import — see instrument.ts's own comment on
// why Sentry's auto-instrumentation needs to load before anything else.
import "./instrument";
import * as Sentry from "@sentry/nestjs";
import * as express from "express";
import type { Request, Response, NextFunction } from "express";
import * as path from "path";
import { randomUUID } from "crypto";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { HttpException, ValidationPipe } from "@nestjs/common";
import { FileStorageService } from "./common/storage/file-storage.service";
import { storedFiles } from "./common/storage/stored-files.middleware";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { prisma } from "@birr/db";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { NotificationsService } from "./modules/notifications/notifications.service";
import { startTrusteeLicenseExpiryScheduler } from "./modules/trustee-licenses/trustee-license-expiry-scheduler";
import { startPortfolioDriftScheduler } from "./modules/investments/portfolio-drift-scheduler";
import { InvestmentTargetsService } from "./modules/investments/investment-targets.service";
import { VaultInvestmentTargetsService } from "./modules/vaults/vault-investment-targets.service";
import { hasAnySessionCookie } from "./common/auth/session";
import { isBirrStaffSession } from "./common/auth/current-birr-staff";
import { resolveFounderFromSession } from "./common/auth/current-founder";

// Payment-provider webhook routes need the exact raw request bytes to
// verify a signature (each adapter's verifyAndParseWebhook recomputes
// an HMAC over the raw body and compares to a header — see
// modules/contributions/providers/*.adapter.ts) — a JSON body parser
// re-serializes the body before a handler ever sees it, which changes
// the bytes and makes every signature check fail, even for a
// genuinely legitimate event. bodyParser: false below plus this exact
// list of paths is what keeps that from happening; keep this list in
// sync with ContributionsController's @Post("webhooks/...") routes.
const WEBHOOK_PATHS = ["/webhooks/stripe", "/webhooks/paystack", "/webhooks/stablecoin"];

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Where /uploads/* files are read from — local disk in dev, the S3-compatible
  // bucket in production (see common/storage/file-storage.service.ts).
  const storage = app.get(FileStorageService);

  // Parses the httpOnly session cookie (see common/auth/session.ts).
  // Independent of the JSON/raw body-parser split below — cookie
  // parsing only touches headers, never the body stream. Registered
  // before the /uploads mounts below (moved up from after them,
  // 2026-09-08) since the message-attachments one now needs req.cookies
  // to authorize a request.
  app.use(cookieParser());

  // Foundation logos are meant to be public (shown on public marketing/
  // waqf-types pages) — see modules/foundations/logo-storage.service.ts.
  app.use("/uploads/logos", storedFiles(storage, "logos", "public"));

  // Same public-by-design posture as Foundation logos above — a Vault's
  // cover is meant to be shown on the public homepage's "Support a
  // cause" cards. See modules/vaults/vault-cover-storage.service.ts.
  app.use("/uploads/vault-covers", storedFiles(storage, "vault-covers", "public"));

  // Cover photos and in-text images for blog articles — public content (see
  // modules/blog/blog-image-storage.service.ts: re-encoded, no metadata).
  app.use("/uploads/blog-images", storedFiles(storage, "blog-images", "public"));

  // Field photos on the homepage's "Our impact" wall — public once the
  // delivery/milestone they document is real (see VaultFieldPhoto). Only ever
  // re-encoded JPEGs with no metadata are written here
  // (modules/impact/field-photo-storage.service.ts).
  app.use("/uploads/field-photos", storedFiles(storage, "field-photos", "public"));

  // Both public by design, same posture as vault-covers above — see
  // Vault.feasibilityReportUrl's own schema comment (a donor's upfront
  // due-diligence material) and VaultMilestone's (proof of work done
  // after giving, per VaultsService's PUBLIC_VAULT_SELECT). Found
  // missing (2026-09-15) while building the Waqf-side equivalent of
  // this feature — neither path was actually mounted here, so any
  // feasibilityReportUrl/evidenceFileUrl saved by
  // VaultDocumentStorageService/VaultMilestoneEvidenceStorageService
  // 404'd when a browser tried to load it.
  app.use("/uploads/vault-documents", storedFiles(storage, "vault-documents", "public"));
  app.use(
    "/uploads/vault-milestone-evidence",
    storedFiles(storage, "vault-milestone-evidence", "public"),
  );

  // Message attachments are private Founder<->Birr-staff correspondence —
  // NOT meant to be public. Until 2026-09-08 this sat under the same
  // blanket `app.use("/uploads", express.static(...))` mount as the
  // public logos above, so a UUID filename was the only thing standing
  // between anyone and an attachment (flagged in
  // message-attachment-storage.service.ts's own comment before this fix).
  // Same authorization shape as MessagesController.list(): any signed-in
  // Birr staff, or a Founder whose Foundation owns the parent message.
  // This runs as raw Express middleware ahead of Nest's own request
  // handling (like express.static itself), so NestJS exceptions don't
  // apply here — errors are plain res.status().json(), not thrown.
  app.use(
    "/uploads/message-attachments",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!hasAnySessionCookie(req)) {
          res.status(401).json({ message: "Not signed in." });
          return;
        }
        const filename = path.basename(req.path);
        const attachment = await prisma.messageAttachment.findFirst({
          where: { url: { endsWith: `/${filename}` } },
          select: { message: { select: { foundationId: true } } },
        });
        if (!attachment) {
          res.status(404).json({ message: "Not found." });
          return;
        }
        if (!(await isBirrStaffSession(req))) {
          const founder = await resolveFounderFromSession(req);
          const owns = await prisma.foundationFounder.findFirst({
            where: { foundationId: attachment.message.foundationId, founderId: founder.id },
            select: { founderId: true },
          });
          if (!owns) {
            res.status(403).json({ message: "You don't have access to this attachment." });
            return;
          }
        }
        next();
      } catch (err) {
        // resolveFounderFromSession throws NestJS HttpExceptions, but
        // this middleware runs ahead of Nest's own pipeline (no
        // AllExceptionsFilter here) — translate the status ourselves
        // rather than falling through to Express's default HTML error
        // page for what's still just "not signed in"/"not found".
        const status = err instanceof HttpException ? err.getStatus() : 500;
        const message = err instanceof HttpException ? err.message : "Internal server error";
        res.status(status).json({ message });
      }
    },
    storedFiles(storage, "message-attachments", "private"),
  );

  // Waqf-side milestone evidence — visible to the Founder who
  // established this fund (per WaqfMilestone's own schema comment on
  // why: unlike Vault's anonymous public donor, there's no one else
  // this needs gating from besides other Founders), gated the same way
  // as message-attachments above: any signed-in Birr staff, or a
  // Founder whose Foundation owns the waqf this milestone belongs to.
  // Found while building this feature (2026-09-15): VaultMilestoneEvidenceStorageService
  // and VaultDocumentStorageService both generate URLs under
  // /uploads/vault-milestone-evidence and /uploads/vault-documents,
  // but neither path is actually mounted anywhere in this file — those
  // URLs currently 404. Not fixed here (out of scope for this Waqf-side
  // feature), but not repeated here either.
  app.use(
    "/uploads/waqf-milestone-evidence",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!hasAnySessionCookie(req)) {
          res.status(401).json({ message: "Not signed in." });
          return;
        }
        const filename = path.basename(req.path);
        const milestone = await prisma.waqfMilestone.findFirst({
          where: { evidenceFileUrl: { endsWith: `/${filename}` } },
          select: { waqf: { select: { foundationId: true } } },
        });
        if (!milestone) {
          res.status(404).json({ message: "Not found." });
          return;
        }
        if (!(await isBirrStaffSession(req))) {
          const founder = await resolveFounderFromSession(req);
          const owns = await prisma.foundationFounder.findFirst({
            where: { foundationId: milestone.waqf.foundationId, founderId: founder.id },
            select: { founderId: true },
          });
          if (!owns) {
            res.status(403).json({ message: "You don't have access to this file." });
            return;
          }
        }
        next();
      } catch (err) {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        const message = err instanceof HttpException ? err.message : "Internal server error";
        res.status(status).json({ message });
      }
    },
    storedFiles(storage, "waqf-milestone-evidence", "private"),
  );

  // CauseCategory.projectPlanFileUrl — a template document attached to a
  // shared catalog entry, not owned by any one Founder/Foundation the
  // way message-attachments/waqf-milestone-evidence are, so the gate is
  // simply "any signed-in Birr staff," with no ownership check. Staff-
  // only, not public, per that field's own schema comment (staff
  // reference material, never shown to a donor) — the opposite posture
  // from vault-documents above. See
  // cause-category-document-storage.service.ts.
  app.use(
    "/uploads/cause-category-documents",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!(await isBirrStaffSession(req))) {
          res.status(401).json({ message: "Not signed in as Birr staff." });
          return;
        }
        next();
      } catch (err) {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        const message = err instanceof HttpException ? err.message : "Internal server error";
        res.status(status).json({ message });
      }
    },
    storedFiles(storage, "cause-category-documents", "private"),
  );

  // Correlation id: reuses an inbound x-request-id (e.g. from a load
  // balancer/proxy that already assigns one) or mints a fresh one,
  // attaches it to the request for AllExceptionsFilter to log against,
  // and echoes it back on the response header so a caller reporting an
  // issue can hand back the exact id that shows up in server logs.
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    const requestId = (req.headers["x-request-id"] as string | undefined) || randomUUID();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (WEBHOOK_PATHS.includes(req.path)) {
      express.raw({ type: "*/*" })(req, res, next);
    } else {
      express.json()(req, res, next);
    }
  });

  // Every @Body()/@Query() DTO across every controller is now a
  // class-validator-decorated class (not a plain interface — those
  // don't exist at runtime, so they couldn't be checked at all before
  // this). whitelist strips any field not declared on the DTO;
  // forbidNonWhitelisted rejects the request outright if one was
  // present, rather than silently dropping it — a malformed/malicious
  // body should fail loudly, not be quietly sanitized. transform lets
  // decorators like @IsUUID/@IsEnum/@Type(() => Number) coerce
  // query-string values (always strings on the wire) to their real
  // types before a controller method ever sees them.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Last-resort safety net — see AllExceptionsFilter's own comment.
  // Every deliberately-thrown HttpException across this codebase passes
  // through unchanged; this only changes behavior for a genuinely
  // unexpected error, which previously fell through to Nest's default
  // handler with no server-side correlation to the client's response.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Dev/staging only — never exposed on a real deployment. This is an
  // internal API (both frontends + the agent service, not a public
  // developer surface), and the docs page itself needs no auth to
  // *view*, so gating it on environment rather than a route guard is
  // the simple, safe default. Every DTO here is already the real
  // class-validator class the ValidationPipe enforces (not a separate
  // hand-written schema), so this can't drift from what the API
  // actually accepts.
  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("Birr API")
      .setDescription(
        "Digital trustee platform for Islamic waqf — the API both Next.js frontends and the agent service call. " +
          "Session-cookie auth (Founder or Birr-staff) covers most routes; POST /ai-agents/:name/* routes use the " +
          "x-agent-api-key header instead — see common/auth for both.",
      )
      .setVersion("0.1.0")
      .addCookieAuth("birr_session")
      .addCookieAuth("birr_staff_session")
      .addApiKey({ type: "apiKey", name: "x-agent-api-key", in: "header" }, "agent-api-key")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api-docs", app, document);
  }

  // Backend is called by both Next.js apps AND the agent service — see
  // CLAUDE.md's Tech Stack section for why this is standalone rather than
  // living inside either Next.js app.
  //
  // CORS: both frontends call this from the browser. Locally, the dev
  // preview tooling assigns a random port per run rather than the fixed
  // FOUNDER_PORTAL_PORT/OPS_CONSOLE_PORT, so a fixed origin allowlist
  // doesn't work there — the localhost/127.0.0.1-on-any-port fallback
  // below covers that case. CORS_ALLOWED_ORIGINS (comma-separated exact
  // origins, e.g. "https://app.example.org,https://ops.example.org") is
  // required for any non-local deployment — set, it's the only allowlist
  // used (the localhost fallback does NOT also apply); unset, only the
  // localhost fallback applies, so a real deployment that forgets to set
  // it fails closed (rejecting every browser origin) rather than open.
  // credentials: true is required for the session cookie to ride along
  // on cross-origin (different-port/different-origin) requests from
  // either frontend.
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // non-browser callers (e.g. server-to-server, curl) carry no Origin header at all
      if (allowedOrigins.length > 0) {
        return callback(null, allowedOrigins.includes(origin));
      }
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
      return callback(null, isLocalhost);
    },
    credentials: true,
  });
  await app.listen(process.env.BACKEND_PORT ?? 4000);

  // The one time-based (not event-triggered) notification this backend
  // sends — see the scheduler's own comment for why this lives here
  // rather than a governed-actions-style call site.
  startTrusteeLicenseExpiryScheduler(app.get(NotificationsService));
  startPortfolioDriftScheduler(
    app.get(InvestmentTargetsService),
    app.get(VaultInvestmentTargetsService),
    app.get(NotificationsService),
  );
}
bootstrap().catch((err: unknown) => {
  Sentry.captureException(err);
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
