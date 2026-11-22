import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { map, type Observable } from "rxjs";
import { setResponseTime } from "../infra/response-time";
import { CACHE_CONTROL_METADATA } from "./cache-control.decorator";
import { isSharedCacheable } from "./no-store.middleware";
import type { SuccessEnvelope, SuccessMeta, WithMeta } from "./response.types";

class MetaEnvelope<T, M extends SuccessMeta> implements WithMeta<T, M> {
  constructor(
    readonly data: T,
    readonly meta: M,
  ) {}
}

export function withMeta<T, M extends SuccessMeta>(data: T, meta: M): WithMeta<T, M> {
  return new MetaEnvelope(data, meta);
}

// QUIRK(cloudflare): its cache key leaves out Accept-Language, so a response it may store names no
// language: an edge hit would carry another requester's.
function successEnvelope(req: Request, res: Response, data: unknown): SuccessEnvelope {
  const lang = isSharedCacheable(res) ? {} : { lang: req.lang };
  return data instanceof MetaEnvelope ? { meta: { ...lang, ...data.meta }, data: data.data } : { meta: lang, data };
}

// WHY: a StreamableFile is a body of its own type (a file, not JSON), which Nest's adapter writes with its headers.
function handlerWroteResponse(res: Response, data: unknown): boolean {
  return res.headersSent || data === undefined || data instanceof StreamableFile;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        if (handlerWroteResponse(res, data)) return data;
        const cacheControl: unknown = Reflect.getMetadata(CACHE_CONTROL_METADATA, ctx.getHandler());
        if (typeof cacheControl === "string") res.setHeader("Cache-Control", cacheControl);
        setResponseTime(req, res);
        return successEnvelope(req, res, data);
      }),
    );
  }
}

export function sendSuccess(req: Request, res: Response, data: unknown): void {
  setResponseTime(req, res);
  res.json(successEnvelope(req, res, data));
}
