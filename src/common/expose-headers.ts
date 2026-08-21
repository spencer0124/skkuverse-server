import type { Request, Response, NextFunction } from "express";

/**
 * Response headers a browser is allowed to read cross-origin.
 *
 * None of the three is CORS-safelisted, and all three are what a client needs to
 * reason about freshness rather than content: `Date` and `Age` measure clock skew
 * (eventmap.materialize's status derivation runs on the device, against the
 * manifest's `Date`, and refuses any response carrying `Age > 0`), and `ETag` is
 * the revalidation token.
 */
export const EXPOSED_RESPONSE_HEADERS = "Date, ETag, Age";

/**
 * Mount app-wide and BEFORE any handler.
 *
 * The ordering is the whole point. The eventmap routes answer a matching
 * If-None-Match with `res.status(304).end()`, returning before they set a single
 * header of their own, and the degraded manifest branch sets only Cache-Control.
 * A 304 is precisely when a client still needs `Date` and `Age`, so a per-route
 * `res.set` would miss the case it exists for.
 *
 * This was inert until skkuverse#17: the API sent no Access-Control-Allow-Origin
 * on any route and answered OPTIONS with 404, so a cross-origin fetch failed
 * before it could read anything exposed here. main.ts now calls enableCors() for
 * the origins in infra/origins.ts, so the header finally does something — for
 * those origins only. It still does NOT by itself make a browser target's clock
 * correction work for any other origin. Native clients read these headers
 * regardless of CORS, so nothing here changes for them.
 *
 * Both this and enableCors()'s `exposedHeaders` are needed. Nest sets the header
 * only on responses it handles as CORS, and the eventmap 304 branches this
 * middleware exists for return before that.
 */
export function exposeResponseHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.set("Access-Control-Expose-Headers", EXPOSED_RESPONSE_HEADERS);
  next();
}
