// Express Request augmentation for the NestJS app (additive; mirrors lib/types.ts
// but adds __startNs used by the X-Response-Time machinery in src/common).
// We do NOT edit lib/types.ts; this file lives under src/ and is picked up by
// tsconfig include "src/**/*".
import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      lang?: import("../lib/types").SupportedLang;
      uid?: string;
      log: Logger;
      // Stashed by LangMiddleware at the front of the chain so sendSuccess()
      // and HttpExceptionFilter can compute X-Response-Time identically to
      // lib/responseHelper.ts (which captures start at request entry).
      __startNs?: bigint;
    }
    interface Response {
      success(data: unknown, meta?: Record<string, unknown>): void;
      error(statusCode: number, code: string, message: string): void;
    }
  }
}

export {};
