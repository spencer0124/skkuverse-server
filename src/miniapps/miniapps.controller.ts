import { Controller, Get, Param } from "@nestjs/common";
import { AppError } from "../common/app-error";
import { MiniAppsService } from "./miniapps.service";
import type { MiniAppDetail, MiniAppIndexEntry } from "./types";

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
  constructor(private readonly miniApps: MiniAppsService) {}

  // GET /miniapps
  @Get()
  getIndex(): MiniAppIndexResponse {
    return { version: this.miniApps.version, miniApps: this.miniApps.list };
  }

  // GET /miniapps/:id
  @Get(":id")
  getDetail(@Param("id") id: string): Readonly<MiniAppDetail> {
    const detail = this.miniApps.getDetail(id);
    if (!detail) {
      throw new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
    }
    return detail;
  }
}
