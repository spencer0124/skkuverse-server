import { Controller, Post, Body, Req, HttpCode } from "@nestjs/common";
import type { Request } from "express";
import config from "../infra/config";
import logger from "../infra/logger";
import { AppError } from "../common/app-error";
import { tokensMatch } from "../common/internal-token";
import {
  NoticesDispatcherService,
  type SweepSummary,
} from "./notices-dispatcher.service";

/**
 * Internal-only controller for the notices feature — port of
 * notices.internal.routes.ts (mounted at /internal/notices).
 *
 * The crawler pings POST /internal/notices/dispatch-pending at the end of each
 * crawl cycle. The handler scans for push-ready, un-dispatched notices and fans
 * them out via the deployed Cloud Function. The body is metadata-only and used
 * solely for log correlation; the work is the sweep itself.
 *
 * Auth: shared secret in the X-Internal-Token header, compared in constant time
 * (common/internal-token.tokensMatch — shared with the event map's publish route
 * since skkuverse#14; the body is unchanged from when it lived here). NO Firebase
 * auth + NO rate limit here — the caller is the crawler service, not an end user.
 * NoticesModule.configure() deliberately does NOT bind FirebaseAuthMiddleware /
 * noticesLimiter to /internal routes.
 *
 * Returns the SweepSummary as a plain value → the global ResponseInterceptor
 * wraps it in the { meta, data } envelope, byte-identical to res.success(summary).
 */

interface PingBody {
  source?: string;
  cycleId?: string;
  crawledAt?: string;
}

@Controller("internal/notices")
export class NoticesInternalController {
  constructor(private readonly dispatcher: NoticesDispatcherService) {}

  // Express res.success() responds 200 (no status set); Nest defaults POST to
  // 201, so @HttpCode(200) restores byte-parity with notices.internal.routes.ts.
  @Post("dispatch-pending")
  @HttpCode(200)
  async dispatchPending(
    @Body() body: PingBody | undefined,
    @Req() req: Request,
  ): Promise<SweepSummary> {
    const expected = config.notices.dispatch.internalToken;
    const provided = req.get("x-internal-token");
    if (!tokensMatch(provided, expected)) {
      throw new AppError(
        "UNAUTHORIZED",
        "invalid or missing X-Internal-Token",
        401,
      );
    }

    const safeBody = (body || {}) as PingBody;
    const triggerSource =
      typeof safeBody.source === "string" && safeBody.source
        ? safeBody.source
        : "internal";
    logger.debug(
      {
        source: triggerSource,
        cycleId: safeBody.cycleId,
        crawledAt: safeBody.crawledAt,
      },
      "[dispatch] ping received",
    );

    return this.dispatcher.sweepPending(triggerSource);
  }
}
