const { Router } = require("express");
const crypto = require("crypto");
const asyncHandler = require("../../lib/asyncHandler");
const serviceConfig = require("./service.config");
const { resolveWeek } = require("./schedule.data");

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /data/:serviceId/week?from=YYYY-MM-DD
 * Returns 7-day resolved schedule for a service.
 */
router.get("/data/:serviceId/week", asyncHandler(async (req, res) => {
  const { serviceId } = req.params;
  const from = req.query.from;

  // Validate from format if provided
  if (from !== undefined && !DATE_RE.test(from)) {
    return res.status(400).json({
      meta: { error: "INVALID_DATE_FORMAT", message: "from must be YYYY-MM-DD" },
      data: null,
    });
  }

  // Check serviceId exists
  if (!serviceConfig[serviceId]) {
    return res.status(404).json({
      meta: { error: "SERVICE_NOT_FOUND", message: `Unknown serviceId: ${serviceId}` },
      data: null,
    });
  }

  const data = await resolveWeek(serviceId, from);
  if (!data) {
    return res.status(404).json({
      meta: { error: "SERVICE_NOT_FOUND", message: `Unknown serviceId: ${serviceId}` },
      data: null,
    });
  }

  // Compute ETag
  const bodyJson = JSON.stringify(data);
  const hash = crypto.createHash("md5").update(bodyJson).digest("hex");
  const etag = `"week-${serviceId}-${data.from}-${hash}"`;

  // 304 check
  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  res.set("ETag", etag);
  res.set("Cache-Control", "public, max-age=300");
  res.success(data);
}));

module.exports = router;
