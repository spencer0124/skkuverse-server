import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import type { SupportedLang } from "../infra/types";

const SUPPORTED: readonly SupportedLang[] = ["ko", "en", "zh"];

/**
 * Port of lib/langMiddleware.ts. Sets req.lang (default "ko") parsed from the
 * Accept-Language first token, and Vary: Accept-Language on every response.
 *
 * Also stashes req.__startNs = process.hrtime.bigint() — this is the request
 * entry point for the X-Response-Time computation, mirroring lib/responseHelper
 * (which Express mounts right after langMiddleware). Both sendSuccess() and
 * HttpExceptionFilter read this value.
 */
@Injectable()
export class LangMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    req.__startNs = process.hrtime.bigint();
    const header = req.headers["accept-language"] || "ko";
    const primary = header.split(",")[0] ?? "ko";
    const candidate = (primary.split("-")[0] ?? "ko").toLowerCase();
    req.lang = (SUPPORTED as readonly string[]).includes(candidate)
      ? (candidate as SupportedLang)
      : "ko";
    res.set("Vary", "Accept-Language");
    next();
  }
}
