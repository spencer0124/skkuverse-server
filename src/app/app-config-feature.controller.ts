import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { AppFeatureService, type AppClientConfig } from "./app-feature.service";

/**
 * Read from the environment at boot, identical for every client and every
 * language, so it may be cached by the client and by a shared cache in front of
 * the origin. Five minutes bounds how long a raised minimum version takes to
 * reach a cold start once the replicas restart with it.
 */
const CONFIG_CACHE_CONTROL = "public, max-age=300";

/**
 * GET /app/config — port of the /app/config route.
 *
 * Mounted with generalLimiter and NO auth. Returns the data object; the global
 * ResponseInterceptor wraps it in the { meta, data } envelope — identical to
 * `res.success({ ios, android })`. `passthrough` keeps that envelope while the
 * handler sets Cache-Control.
 */
@Controller("app")
export class AppConfigFeatureController {
  constructor(private readonly appFeature: AppFeatureService) {}

  @Get("config")
  getConfig(@Res({ passthrough: true }) res: Response): AppClientConfig {
    res.set("Cache-Control", CONFIG_CACHE_CONTROL);
    return this.appFeature.getConfig();
  }
}
