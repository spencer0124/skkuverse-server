/**
 * Thin re-export of features/bus/jongro.registry (read-only shared import).
 *
 * Importing the original module triggers ALL its fail-loud validation at
 * module-load time: validateServiceKey() + validateRoutes(jongro-routes.json),
 * deepFreeze, and a throw on any invalid data (the original additionally
 * process.exit(1)s in non-test, but the throw is the parity-safe surface we
 * rely on here). We re-export verbatim so the derived registry (cache-key
 * `code`, listUrl/locUrl, station mapping) is byte-identical to the Express
 * app — no reimplementation, no drift.
 */
export {
  jongroRoutes,
  getJongroRouteByCode,
  getJongroRouteById,
  buildJongroListUrl,
  buildJongroLocUrl,
  validateServiceKey,
  validateRoutes,
  type JongroRoute,
  type ValidationResult,
} from "../../../features/bus/jongro.registry";
