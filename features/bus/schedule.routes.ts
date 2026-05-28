import { Router } from "express";
import crypto from "crypto";
import asyncHandler from "../../lib/asyncHandler";
import { t } from "../../lib/i18n";
import serviceConfig from "./service.config";
import { resolveWeek, resolveSmartSchedule } from "./schedule.data";
import type { SupportedLang } from "../../lib/types";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /data/:serviceId/week?from=YYYY-MM-DD
 * Returns 7-day resolved schedule for a service.
 */
router.get(
  "/data/:serviceId/week",
  asyncHandler(async (req, res) => {
    const { serviceId } = req.params as { serviceId: string };
    // Preserve original .js coercion semantics: if client sends `?from=A&from=B`
    // (Express parses as string[]), the array is passed to DATE_RE.test() which
    // coerces to "A,B" and fails the regex → 400. Cast is a lie at the type
    // boundary but matches runtime behavior exactly.
    const from = req.query.from as string | undefined;

    // pino-http attaches `log` to req. Original .js used direct access;
    // preserve fail-loud — req.log undefined would throw → 500 → ops alert
    // (matches pre-TS behavior). Augmented in lib/types.ts.
    req.log.warn(
      { serviceId },
      "deprecated: /week endpoint called, use /smart",
    );

    // Validate from format if provided
    if (from !== undefined && !DATE_RE.test(from)) {
      return res.error(
        400,
        "INVALID_DATE_FORMAT",
        "from must be YYYY-MM-DD",
      );
    }

    // Check serviceId exists
    if (!serviceConfig[serviceId]) {
      return res.error(
        404,
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
      );
    }

    const data = await resolveWeek(serviceId, from);
    if (!data) {
      return res.error(
        404,
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
      );
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
  }),
);

/**
 * GET /data/:serviceId/smart
 * Returns the most relevant week with auto-selected date, hidden days filtered out.
 */
router.get(
  "/data/:serviceId/smart",
  asyncHandler(async (req, res) => {
    const { serviceId } = req.params as { serviceId: string };

    if (!serviceConfig[serviceId]) {
      return res.error(
        404,
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
      );
    }

    const result = await resolveSmartSchedule(serviceId);
    if (!result) {
      return res.error(
        404,
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
      );
    }

    const lang: SupportedLang = (req.lang ?? "ko") as SupportedLang;

    // Spread for immutability; inject i18n message for non-active statuses
    const data =
      result.status === "active"
        ? { ...result }
        : { ...result, message: t(`schedule.${result.status}`, lang) };

    // Compute ETag — use from for active, status for suspended/noData
    const bodyJson = JSON.stringify(data);
    const hash = crypto.createHash("md5").update(bodyJson).digest("hex");
    const etag = `"smart-${serviceId}-${data.from || data.status}-${hash}"`;

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=300");
    res.success(data);
  }),
);

export = router;
