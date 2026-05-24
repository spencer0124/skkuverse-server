export type SupportedLang = "ko" | "en" | "zh";

// Express Request/Response augmentation.
// req.lang is set by langMiddleware; req.uid by authMiddleware.
// res.success / res.error are attached by responseHelper.
declare global {
  namespace Express {
    interface Request {
      // Optional because /api-docs and other routes mounted before langMiddleware
      // (see index.js) receive Request before req.lang is populated. Consumers
      // must `?? "ko"` or null-check; the langMiddleware-mounted subtree can
      // narrow this with a type guard or assertion at the route layer.
      lang?: SupportedLang;
      uid?: string;
    }
    interface Response {
      success(data: unknown, meta?: Record<string, unknown>): void;
      error(statusCode: number, code: string, message: string): void;
    }
  }
}

export {};
