import * as express from "express";
import type { Request, Response, NextFunction } from "express";
import * as path from "path";
import { randomUUID } from "crypto";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { NotificationsService } from "./modules/notifications/notifications.service";
import { startTrusteeLicenseExpiryScheduler } from "./modules/trustee-licenses/trustee-license-expiry-scheduler";

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

  // Serves uploaded Foundation logos (see
  // modules/foundations/logo-storage.service.ts). Registered before the
  // JSON/raw body-parser switch below — safe regardless of ordering
  // since static GETs never carry a body, but keeping it first avoids
  // any doubt about interaction with that split.
  app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

  // Parses the httpOnly session cookie (see common/auth/session.ts).
  // Independent of the JSON/raw body-parser split below — cookie
  // parsing only touches headers, never the body stream.
  app.use(cookieParser());

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
}
bootstrap();
