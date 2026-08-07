import { Injectable, type OnModuleInit } from "@nestjs/common";
import logger from "../infra/logger";
import { ensureIndexes } from "./eventmap.data";

/**
 * EventMapService — boot-time owner of the event map collections.
 *
 * Phase 1 (skkuverse#13) is storage only: this service exists to create the
 * indexes and nothing else. The materializer, the manifest memo and the publish
 * path arrive in Phase 2 (#14).
 *
 * onModuleInit follows AdDataService: ensureIndexes() inside ONE non-fatal
 * try/catch that warn-logs and continues. Index creation is a startup nicety,
 * not a serving prerequisite — an Atlas hiccup during boot must not take the
 * API down, and every index here is idempotent so the next boot retries it.
 *
 * This runs on every process (poller + both api replicas). createIndex is
 * idempotent, so the duplication is free — same as ad/ and building/ already do.
 */
@Injectable()
export class EventMapService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    try {
      await ensureIndexes();
    } catch (err) {
      logger.warn(
        { err: (err as { message?: string }).message },
        "[eventmap] Startup initialization failed",
      );
    }
  }
}
