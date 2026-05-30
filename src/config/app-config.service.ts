import { Injectable } from "@nestjs/common";
import config from "../infra/config";

/**
 * Typed, read-only accessor over the existing lib/config.ts singleton.
 *
 * We delegate to lib/config rather than re-reading process.env so the resolved
 * values (devDbName/apiUrl/getModeLabel + the USE_PROD_API forcing in prod) are
 * IDENTICAL to the Express app — single source of truth, no drift. Importing
 * lib/config also (re)triggers its own fail-loud process.exit(1) outside test,
 * complementing the Nest-native throw in env.validation.ts.
 */
@Injectable()
export class AppConfigService {
  get env(): string {
    return config.env;
  }

  get isProduction(): boolean {
    return config.isProduction;
  }

  get isDevelopment(): boolean {
    return config.isDevelopment;
  }

  get isTest(): boolean {
    return config.isTest;
  }

  get useProdApi(): boolean {
    return config.useProdApi;
  }

  get port(): number | string {
    return config.port;
  }

  get mongo(): {
    url: string | undefined;
    dbName: string | undefined;
    collections: typeof config.mongo.collections;
  } {
    return {
      url: config.mongo.url,
      dbName: config.mongo.dbName,
      collections: config.mongo.collections,
    };
  }

  get api(): {
    hsscNew: string | undefined;
    seoulBusServiceKey: string | undefined;
    stationHyehwa: string | undefined;
  } {
    return {
      hsscNew: config.api.hsscNew,
      seoulBusServiceKey: config.api.seoulBusServiceKey,
      stationHyehwa: config.api.stationHyehwa,
    };
  }

  get naver(): {
    apiKeyId: string | undefined;
    apiKey: string | undefined;
    styleId: string | undefined;
  } {
    return {
      apiKeyId: config.naver.apiKeyId,
      apiKey: config.naver.apiKey,
      styleId: config.naver.styleId,
    };
  }

  get firebase(): { serviceAccount: string | null } {
    return { serviceAccount: config.firebase.serviceAccount };
  }

  get app(): typeof config.app {
    return config.app;
  }

  get building(): {
    dbName: string | undefined;
    collections: typeof config.building.collections;
    syncIntervalMs: number;
  } {
    return {
      dbName: config.building.dbName,
      collections: config.building.collections,
      syncIntervalMs: config.building.syncIntervalMs,
    };
  }

  getModeLabel(): string {
    return config.getModeLabel();
  }
}
