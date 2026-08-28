import type { Logger } from "pino";

export type SupportedLang = "ko" | "en" | "zh";

/**
 * The same three, as a value — for iterating. Import this rather than writing
 * the array out: a language added to the union and missed in one hand-written
 * list is a session "blank in every language" that is not, or a manifest that
 * refuses a `?lang=` the union admits.
 */
export const SUPPORTED_LANGS: readonly SupportedLang[] = ["ko", "en", "zh"];

/**
 * Authored text in every language we hold. `ko` is the source language and
 * required; `en`/`zh` are optional. Resolved with `pick()` in `./i18n` —
 * `text[lang] → en → ko`, blank treated as absent — so no consumer ever ships
 * one of these objects to a client.
 *
 * Infra rather than a feature type: the event map authors its content this way,
 * and the map catalogue authors its layer and chip labels the same way, so the
 * one resolver they share has to live where both can reach it without either
 * importing the other.
 */
export interface I18n {
  ko: string;
  en?: string;
  zh?: string;
}

// Express Request/Response augmentation.
// req.lang is set by langMiddleware; req.uid by authMiddleware.
// res.success / res.error are attached by responseHelper.
// req.log is set by pino-http (declared here because pino-http only augments
// http.IncomingMessage, and the augmentation does not propagate to
// Express.Request reliably across all consumer setups).
declare global {
  namespace Express {
    interface Request {
      // Optional because /api-docs and other routes mounted before langMiddleware
      // (see index.js) receive Request before req.lang is populated. Consumers
      // must `?? "ko"` or null-check; the langMiddleware-mounted subtree can
      // narrow this with a type guard or assertion at the route layer.
      lang?: SupportedLang;
      uid?: string;
      // pino-http installs `log` on every request; preserve original
      // fail-loud behavior — accessing `.warn` on undefined throws → 500
      // → ops alert. Tests using miniApp without pino-http hit the same
      // throw path, matching original .js semantics.
      log: Logger;
    }
    interface Response {
      success(data: unknown, meta?: Record<string, unknown>): void;
      error(statusCode: number, code: string, message: string): void;
    }
  }
}

export {};
