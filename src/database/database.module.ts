import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AppConfigService } from "../config/app-config.service";
import { closeClient, getClient, ping } from "../../lib/db";

/**
 * DB tokens for injecting the EXISTING lib/db singleton (raw mongodb driver).
 *
 * Parity decision (see migration spec §c): the bus feature's reads/writes go
 * through lib/db.getClient() + config.mongo.dbName, NOT through Mongoose. This
 * guarantees byte-identical cache documents, queries, TTL index names, and a
 * single connection pool. So BusCacheService/ScheduleService (added by the bus
 * agent) inject DB_CLIENT/DB_PING and call the same lib/db functions the Express
 * app uses.
 */
export const DB_CLIENT = "DB_CLIENT";
export const DB_PING = "DB_PING";
export const DB_CLOSE = "DB_CLOSE";

/**
 * @Global DatabaseModule.
 *
 * 1. Owns a Mongoose connection (forRootAsync) to the bus_campus DB — the
 *    primary connection. dbName = config.mongo.dbName (devDbName: _dev/_test/
 *    none); maxPoolSize 5 / minPoolSize 1, matching lib/db's MongoClient pool.
 *    Per-DB connections for any future schedule DB can be added with a named
 *    connection (connectionName). NOT needed for bus — the INJA/JAIN exemption
 *    is irrelevant to the 7 bus endpoints (schedule reads bus_schedules /
 *    bus_overrides from this same bus_campus DB).
 *
 * 2. Exposes lib/db's getClient/ping/closeClient as injectable providers so the
 *    actual bus reads/writes stay on the existing driver-level path (parity).
 *
 * Note: lib/config (imported transitively by lib/db) throws/process.exit(1) if
 * MONGO_URL is missing — fail-loud preserved. The Mongoose useFactory also
 * surfaces a missing URL loudly because cfg.mongo.url is undefined.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => {
        if (!cfg.mongo.url) {
          // Fail-loud: never default to a silent connection string.
          throw new Error("FATAL: MONGO_URL is not set (config.mongo.url)");
        }
        return {
          uri: cfg.mongo.url,
          dbName: cfg.mongo.dbName,
          maxPoolSize: 5,
          minPoolSize: 1,
        };
      },
    }),
  ],
  providers: [
    { provide: DB_CLIENT, useValue: getClient },
    { provide: DB_PING, useValue: ping },
    { provide: DB_CLOSE, useValue: closeClient },
  ],
  exports: [DB_CLIENT, DB_PING, DB_CLOSE, MongooseModule],
})
export class DatabaseModule {}
