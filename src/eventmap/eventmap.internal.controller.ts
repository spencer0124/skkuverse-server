import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import config from "../infra/config";
import logger from "../infra/logger";
import { AppError } from "../common/app-error";
import { tokensMatch } from "../common/internal-token";
import {
  EventMapMaterializerService,
  type PublishSummary,
} from "./eventmap-materializer.service";

/**
 * Internal-only event map route (skkuverse#14), mounted at /internal/eventmap.
 *
 * This is the ops lever for the one week a year it matters: the poller's 60 s
 * tick is fine for a menu correction, but a rain cancellation should be live
 * before the next tick. Same publish() the poller calls, so a festival-night
 * force-publish exercises code that has been running all week.
 *
 * `dryRun: true` validates and materializes, returning the summary WITHOUT
 * writing. With no admin UI every content edit is hand-typed JSON, so this is
 * the safety net: it reports what would ship, and which sessions were dropped
 * and why, before anything is published.
 *
 * Auth: shared secret in X-Internal-Token, compared in constant time via
 * common/internal-token (shared with the notices dispatch route). NO Firebase
 * auth and — deliberately — NO rate limit: EventMapModule.configure() binds the
 * limiter to "eventmap" only, which does not match the "internal" prefix. During
 * an incident ops must be able to hammer this without being throttled.
 */

interface PublishBody {
  layerSetId?: unknown;
  dryRun?: unknown;
  force?: unknown;
}

@Controller("internal/eventmap")
export class EventMapInternalController {
  constructor(private readonly materializer: EventMapMaterializerService) {}

  // Nest defaults POST to 201; @HttpCode(200) matches the notices internal route
  // and the { meta, data } envelope every other endpoint returns.
  @Post("publish")
  @HttpCode(200)
  async publish(
    @Body() body: PublishBody | undefined,
    @Req() req: Request,
  ): Promise<PublishSummary> {
    // INTERNAL_DISPATCH_TOKEN, deliberately shared with the notices route rather
    // than given a second env var: both callers are us, both are behind the same
    // network boundary, and §13's runbook already documents this one secret. A
    // second token would be one more thing to have missing on the host at 22:00.
    if (!tokensMatch(req.get("x-internal-token"), config.notices.dispatch.internalToken)) {
      throw new AppError("UNAUTHORIZED", "invalid or missing X-Internal-Token", 401);
    }

    const safeBody = body ?? {};
    const layerSetId =
      typeof safeBody.layerSetId === "string" && safeBody.layerSetId.trim() !== ""
        ? safeBody.layerSetId.trim()
        : undefined;
    const dryRun = safeBody.dryRun === true;
    // `force` publishes even when the inputs are unchanged. It exists for the one
    // case the content hash structurally cannot see: a deploy that changes the
    // materializer's output or the server-generated strings on the wire, leaving
    // every input identical while the payload should differ.
    const force = safeBody.force === true;

    const summary = await this.materializer.publish({ layerSetId, dryRun, force });
    logger.info(
      {
        layerSetId: summary.layerSetId,
        reason: summary.reason,
        version: summary.version,
        dryRun,
        force,
      },
      "[eventmap] Force-publish requested",
    );
    return summary;
  }
}
