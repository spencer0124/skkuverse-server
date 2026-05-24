/**
 * Build a minimal Express app for supertest-style integration tests that mount
 * specific routers without going through the full `require("../index")` boot
 * (which would force 5+ jest.mock blocks for unrelated startup hooks).
 *
 * Reference implementations this helper subsumes:
 *   - __tests__/notices-dispatch.test.js  buildInternalApp() (no lang meta)
 *   - __tests__/building-routes.test.js   buildApp()         (lang meta injected)
 *
 * options:
 *   useJsonBody     (default true): mount express.json() before route handlers
 *   middlewares     ([]):           middleware to apply before responseHelper
 *                                   (e.g., langMiddleware)
 *   routes          ([]):           [{ path, router }] to mount after responseHelper
 *   injectLangMeta  (default true): when true, res.success(payload, meta) → { meta: { lang, ...meta }, data }
 *                                   when false, res.success(data) → { data }
 *
 * The final arity-4 error handler converts async route rejections to
 * 500 { error: { code: "TEST_ERROR", message } } so failures are visible to the test.
 *
 * TODO(ts): type as `(opts?: BuildMiniAppOptions) => import("express").Express`
 * with a BuildMiniAppOptions interface mirroring the fields above.
 */
const express = require("express");

module.exports = function buildMiniApp({
  useJsonBody = true,
  middlewares = [],
  routes = [],
  injectLangMeta = true,
} = {}) {
  const app = express();
  if (useJsonBody) app.use(express.json());
  for (const mw of middlewares) app.use(mw);

  app.use((req, res, next) => {
    if (injectLangMeta) {
      res.success = (payload, meta = {}) =>
        res.json({ meta: { lang: req.lang, ...meta }, data: payload });
    } else {
      res.success = (data) => res.json({ data });
    }
    res.error = (status, code, message) =>
      res.status(status).json({ error: { code, message } });
    next();
  });

  for (const { path, router } of routes) app.use(path, router);

  // arity-4 signature is required for Express to recognize this as an error handler
  app.use((err, req, res, next) => {
    void next;
    res.status(500).json({ error: { code: "TEST_ERROR", message: err.message } });
  });

  return app;
};
