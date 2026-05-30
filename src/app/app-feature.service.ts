import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";

/**
 * AppFeatureService — port of features/app/app.routes.ts's single handler.
 *
 * Trivial static passthrough: returns { ios, android } straight from the
 * resolved lib/config (via AppConfigService.app), no DB, no caching, no auth.
 * Byte-parity with `res.success({ ios, android })`.
 */
@Injectable()
export class AppFeatureService {
  constructor(private readonly appConfig: AppConfigService) {}

  /** Returns the client app version-gate config: { ios, android }. */
  getConfig(): {
    ios: { minVersion: string; updateUrl: string | null };
    android: { minVersion: string; updateUrl: string | null };
  } {
    const { ios, android } = this.appConfig.app;
    return { ios, android };
  }
}
