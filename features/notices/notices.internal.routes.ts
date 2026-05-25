/**
 * Internal-only routes for the notices feature.
 *
 * The crawler pings POST /internal/notices/dispatch-pending at the end of
 * each crawl cycle. The handler scans for push-ready, un-dispatched
 * notices and fans them out via the deployed sendNotification Cloud
 * Function. The body is metadata-only (source/cycleId/crawledAt) and is
 * used solely for log correlation; the work is the sweep itself.
 *
 * Auth: shared secret in the X-Internal-Token header, compared in
 * constant time. No Firebase auth here — the caller is the crawler
 * service, not an end user.
 */
import express from "express";
import crypto from "crypto";
import asyncHandler from "../../lib/asyncHandler";
import config from "../../lib/config";
import logger from "../../lib/logger";
import { sweepPending } from "./notices.dispatcher";

const router = express.Router();

function tokensMatch(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface PingBody {
  source?: string;
  cycleId?: string;
  crawledAt?: string;
}

router.post(
  "/dispatch-pending",
  asyncHandler(async (req, res) => {
    const expected = config.notices.dispatch.internalToken;
    const provided = req.get("x-internal-token");
    if (!tokensMatch(provided, expected)) {
      return res.error(
        401,
        "UNAUTHORIZED",
        "invalid or missing X-Internal-Token",
      );
    }

    const body = (req.body || {}) as PingBody;
    const triggerSource =
      typeof body.source === "string" && body.source ? body.source : "internal";
    logger.debug(
      {
        source: triggerSource,
        cycleId: body.cycleId,
        crawledAt: body.crawledAt,
      },
      "[dispatch] ping received",
    );

    const summary = await sweepPending(triggerSource);
    return res.success(summary);
  }),
);

export = router;
