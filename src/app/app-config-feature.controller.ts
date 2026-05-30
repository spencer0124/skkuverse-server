import { Controller, Get } from "@nestjs/common";
import { AppFeatureService } from "./app-feature.service";

/**
 * GET /app/config — port of features/app/app.routes.ts.
 *
 * Mounted with generalLimiter and NO auth (index.ts:138). Returns the data
 * object; the global ResponseInterceptor wraps it in the { meta, data }
 * envelope — identical to `res.success({ ios, android })`. No ETag/304, no
 * Cache-Control, no extra meta, so a plain return (not @Res()) is correct.
 */
@Controller("app")
export class AppConfigFeatureController {
  constructor(private readonly appFeature: AppFeatureService) {}

  @Get("config")
  getConfig(): {
    ios: { minVersion: string; updateUrl: string | null };
    android: { minVersion: string; updateUrl: string | null };
  } {
    return this.appFeature.getConfig();
  }
}
