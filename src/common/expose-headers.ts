import type { Request, Response, NextFunction } from "express";

/**
 * Response headers a browser is allowed to read cross-origin.
 *
 * `ETag` is not CORS-safelisted and is the revalidation token, so a browser
 * client cannot do a conditional request without this.
 *
 * `Date` and `Age` were exposed alongside it for the client's clock-offset
 * measurement — the device measured skew from the manifest's `Date` and refused
 * any response carrying `Age > 0`. That layer is gone: status derivation now
 * runs against the device clock unadjusted, so neither header has a reader.
 */
export const EXPOSED_RESPONSE_HEADERS = "ETag";

/**
 * Mount app-wide and BEFORE any handler.
 *
 * The ordering is the whole point. The eventmap routes answer a matching
 * If-None-Match with `res.status(304).end()`, returning before they set a single
 * header of their own, and the degraded manifest branch sets only Cache-Control.
 * A 304 is precisely the response whose `ETag` a client still needs to read, so
 * a per-route `res.set` would miss the case it exists for.
 *
 * This was inert until skkuverse#17: the API sent no Access-Control-Allow-Origin
 * on any route and answered OPTIONS with 404, so a cross-origin fetch failed
 * before it could read anything exposed here. main.ts now calls enableCors() for
 * the origins in infra/origins.ts, so the header finally does something — for
 * those origins only. Native clients read the header regardless of CORS, so
 * nothing here changes for them.
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
