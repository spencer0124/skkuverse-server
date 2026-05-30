import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { map, type Observable } from "rxjs";

/**
 * Global success-envelope interceptor.
 *
 * Bus controllers use @Res() + sendSuccess() and write the response directly
 * (for ETag/304 + extra-meta parity), so for those handlers this interceptor is
 * a no-op: when a handler already wrote the response (res.headersSent) or
 * returned undefined (the @Res() void return), we pass the value through
 * untouched. Health endpoints are also @Res() raw JSON (not enveloped) and are
 * skipped the same way.
 *
 * For any plain handler that DOES return a value, we wrap it in the standard
 * envelope { meta: { lang, ... }, data } and set X-Response-Time — matching
 * lib/responseHelper.ts res.success.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        if (res.headersSent || data === undefined) {
          // @Res() handler already wrote the response (bus + health).
          return data;
        }
        const start = req.__startNs ?? process.hrtime.bigint();
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
        return { meta: { lang: req.lang }, data };
      }),
    );
  }
}
