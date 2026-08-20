import { Body, Controller, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import config from "../infra/config";
import logger from "../infra/logger";
import { AppError } from "../common/app-error";
import { tokensMatch } from "../common/internal-token";
import { MiniAppsService } from "./miniapps.service";
import {
  MiniAppNotificationsService,
  type MiniAppNotificationDraft,
  type SendOutcome,
} from "./miniapps-notifications.service";

/**
 * Internal-only mini-app send route, mounted at /internal/miniapps.
 *
 * Auth: the shared secret in X-Internal-Token, constant-time compared — the
 * same one the notices dispatch and event map publish routes use. NO Firebase
 * auth and NO rate limit: the caller is ops, and during an incident they must be
 * able to retry without being throttled. MiniAppsModule.configure() binds the
 * limiter to "miniapps" only, which does not match the "internal" prefix.
 *
 * WHAT THIS DOES AND DOES NOT CLOSE. ADR 0006 §7 names an "any key targets any
 * topic" gap and answers it with a per-club console login; that console is
 * spencer0124/skkuverse#23 and is not built. What this route closes is the half
 * that matters for the Cloud Function: `miniAppId` comes from the PATH, and the
 * CF has no `topics` field to honour, so no caller can reach a topic outside the
 * mini app it named. What it does NOT close is that one shared token can name
 * any mini app. For ESKARA the sender is us and no club holds a key, so the
 * residual is acceptable; per-caller scoping arrives with the console.
 */
@Controller("internal/miniapps")
export class MiniAppsInternalController {
  constructor(
    private readonly miniApps: MiniAppsService,
    private readonly notifications: MiniAppNotificationsService,
  ) {}

  // Nest defaults POST to 201; @HttpCode(200) matches the other internal routes
  // and the { meta, data } envelope every other endpoint returns.
  @Post(":id/notifications")
  @HttpCode(200)
  async send(
    @Param("id") id: string,
    @Body() body: MiniAppNotificationDraft | undefined,
    @Req() req: Request,
  ): Promise<SendOutcome> {
    if (!tokensMatch(req.get("x-internal-token"), config.notices.dispatch.internalToken)) {
      throw new AppError("UNAUTHORIZED", "invalid or missing X-Internal-Token", 401);
    }

    // The registry is the one place that knows what a mini app is, so an unknown
    // slug is rejected here rather than becoming a topic nobody is subscribed to
    // and a feed row nobody can read.
    if (!this.miniApps.getDetail(id)) {
      throw new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
    }

    const result = await this.notifications.send(id, body ?? {});
    if ("problems" in result) {
      throw new AppError("INVALID_PAYLOAD", result.problems.join("; "), 400);
    }

    logger.info(
      {
        miniAppId: id,
        notificationId: result.notificationId,
        delivered: result.delivery !== null,
      },
      "[miniapp] Send requested",
    );
    return result;
  }
}
