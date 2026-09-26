import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { BRIDGE_ORIGINS, WEB_ORIGIN } from "../infra/origins";
import { firstPartyOrigins } from "../miniapps/miniapps";

interface PlatformGate {
  minVersion: string;
  updateUrl: string | null;
}

/**
 * Shape of GET /app/config. Declared once and reused by the controller so the
 * two can't drift (they previously repeated the literal type).
 *
 * ADDITIVE ONLY. Old clients read { ios, android } and ignore unknown keys, so
 * new sections are safe; removing or retyping an existing key is not.
 */
export interface AppClientConfig {
  ios: PlatformGate;
  android: PlatformGate;
  webview: {
    /** Origins allowed to reach the native RN bridge. See infra/origins.ts. */
    bridgeOrigins: string[];
  };
  web: {
    /**
     * Marketing/launcher origin the client builds mini-app share links and
     * add-to-home-screen shortcuts against. Published so the client doesn't
     * have to hardcode a second copy of a host this file already owns.
     */
    origin: string;
  };
  miniapps: {
    /**
     * First-party mini-app origin → its mini-app id. The client opens any URL
     * on one of these origins in that mini app's shell instead of the generic
     * /webview, where the page would show its "open in the app" gate. See
     * FIRST_PARTY_MINIAPP_ORIGINS in infra/origins.ts.
     */
    origins: Record<string, string>;
  };
}

/**
 * AppFeatureService — the GET /app/config handler.
 *
 * Static passthrough: version gate straight from the resolved lib/config (via
 * AppConfigService.app), bridge allowlist straight from infra/origins. No DB,
 * no caching, no auth. The { ios, android } half stays byte-identical to
 * `res.success({ ios, android })`.
 *
 * The allowlist rides here rather than on its own endpoint because the client
 * already fetches /app/config during boot (checkForceUpdate), so publishing it
 * costs zero additional round-trips — and a security list the client needs
 * before its first webview opens must not depend on a second request that may
 * not have landed yet.
 */
@Injectable()
export class AppFeatureService {
  constructor(private readonly appConfig: AppConfigService) {}

  /** Returns the client app config: version gate, bridge allowlist, web origin, mini-app origins. */
  getConfig(): AppClientConfig {
    const { ios, android } = this.appConfig.app;
    return {
      ios,
      android,
      webview: { bridgeOrigins: [...BRIDGE_ORIGINS] },
      web: { origin: WEB_ORIGIN },
      miniapps: { origins: { ...firstPartyOrigins } },
    };
  }
}
