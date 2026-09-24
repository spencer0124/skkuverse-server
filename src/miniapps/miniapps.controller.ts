import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError } from "../common/app-error";
import { MiniAppsService } from "./miniapps.service";
import { MiniAppNotificationsService } from "./miniapps-notifications.service";
import type {
  MiniAppDetail,
  MiniAppIndexEntry,
  MiniAppNotificationEntry,
} from "./types";
import type { SupportedLang } from "../infra/types";

/**
 * The registry is JSON shipped with the build, identical for every client and
 * every language, and it changes only on deploy — so it may be cached by the
 * client and by a shared cache in front of the origin. Five minutes bounds how
 * long a deploy that edits it takes to be seen.
 */
const REGISTRY_CACHE_CONTROL = "public, max-age=300";

interface MiniAppIndexResponse {
  version: number;
  miniApps: ReadonlyArray<Readonly<MiniAppIndexEntry>>;
}

/**
 * GET /miniapps and GET /miniapps/:id — the mini-app registry surface.
 *
 * Static, unauthenticated, no DB: the registry is config-shaped public data, so
 * it follows the notices/sources.json convention (validated JSON in-repo)
 * rather than living in Mongo, which this codebase reserves for crawled data.
 *
 * Both handlers return plain objects; the global ResponseInterceptor wraps them
 * in the { meta, data } envelope. An unknown slug throws AppError → the global
 * HttpExceptionFilter renders { error: { code, message } } at 404.
 *
 * The root @Get() is not captured by @Get(":id") — Nest matches the empty path
 * first, same as the Express router did.
 */
@Controller("miniapps")
export class MiniAppsController {
  constructor(
    private readonly miniApps: MiniAppsService,
    private readonly notifications: MiniAppNotificationsService,
  ) {}

  // GET /miniapps
  @Get()
  getIndex(@Res({ passthrough: true }) res: Response): MiniAppIndexResponse {
    res.set("Cache-Control", REGISTRY_CACHE_CONTROL);
    return { version: this.miniApps.version, miniApps: this.miniApps.list };
  }

  /**
   * GET /miniapps/:id/notifications — the broadcast feed.
   *
   * Unauthenticated, like the registry endpoints beside it, because the feed
   * carries no user dimension at all (skkuverse-app ADR 0002, Revisited).
   *
   * Declared BEFORE @Get(":id") so ":id" cannot swallow it — Nest matches in
   * declaration order, and ":id/notifications" is a longer path that a bare
   * ":id" route would not catch, but keeping the order explicit means a future
   * ":id/anything" cannot silently 404 either.
   *
   * Cache-Control is short on purpose. This page is opened seconds after a push
   * woke the device, so a long TTL would show an empty feed to exactly the
   * person the notification was for.
   */
  @Get(":id/notifications")
  async getNotifications(
    @Param("id") id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MiniAppNotificationEntry[]> {
    if (!this.miniApps.getDetail(id)) {
      throw new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
    }
    res.set("Cache-Control", "public, max-age=15");
    return this.notifications.feed(id, (req.lang ?? "ko") as SupportedLang);
  }

  // GET /miniapps/:id
  @Get(":id")
  getDetail(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ): Readonly<MiniAppDetail> {
    const detail = this.miniApps.getDetail(id);
    if (!detail) {
      throw new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
    }
    // Set only on success, so a 404 for a slug that ships later is not kept.
    res.set("Cache-Control", REGISTRY_CACHE_CONTROL);
    return detail;
  }
}
