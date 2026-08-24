import * as express from "express";
import type { Request, Response, NextFunction } from "express";
import * as path from "path";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

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
      .addApiKey({ type: "apiKey", name: "x-agent-api-key", in: "header" }, "agent-api-key")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api-docs", app, document);
  }

  // Backend is called by both Next.js apps AND the agent service — see
  // CLAUDE.md's Tech Stack section for why this is standalone rather than
  // living inside either Next.js app.
  //
  // CORS: both frontends call this from the browser, and the local dev
  // preview tooling assigns a random port per run rather than the fixed
  // FOUNDER_PORTAL_PORT/OPS_CONSOLE_PORT, so a fixed origin allowlist
  // doesn't work here. Scoped to localhost/127.0.0.1 on any port —
  // revisit with a real allowlist (or a proxy) before any non-local
  // deployment. credentials: true is required for the session cookie to
  // ride along on cross-origin (different-port) requests from either
  // frontend.
  app.enableCors({ origin: /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/, credentials: true });
  await app.listen(process.env.BACKEND_PORT ?? 4000);
}
bootstrap();
