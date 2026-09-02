import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Last-resort safety net, registered globally in main.ts. An
 * HttpException (BadRequestException, NotFoundException,
 * ForbiddenException, etc. — thrown deliberately, all over this
 * codebase) already carries an intentional, safe-to-show status and
 * message; it passes through completely unchanged here, identical to
 * Nest's own default behavior. Anything else — a genuine bug, an
 * unexpected Prisma error, a third-party library throwing a raw Error —
 * previously fell through to Nest's default handler too, which returns
 * a generic 500 but gives no way to correlate that response back to a
 * specific server-side log line. This filter closes that gap: it logs
 * the real error server-side (with the request's correlation id — see
 * the requestId middleware in main.ts) and returns a sanitized generic
 * body, never the raw error message or stack trace, which could leak
 * internal details (table/column names, file paths, library internals)
 * to whoever's calling the API.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const requestId = request.requestId ?? "unknown";
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.originalUrl ?? request.url} [requestId=${requestId}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
      requestId,
    });
  }
}
