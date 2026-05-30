import { Injectable, type OnModuleInit } from "@nestjs/common";
import logger from "../../lib/logger";
import {
  getPlacements,
  ensureIndexes,
  seedIfEmpty,
} from "../../features/ad/ad.data";
import type { AdItem, Placement, PlacementMap } from "../../features/ad/types";

/**
 * AdDataService — thin @Injectable wrapper over the validated
 * features/ad/ad.data module (raw mongodb driver via lib/db, NOT Mongoose).
 *
 * Delegates getPlacements (60s in-memory cache + DB read + FALLBACK_PLACEMENTS
 * fail-soft) verbatim so the placement payload, cache TTL, weighted-select, and
 * fallback behavior are byte-identical to the Express app.
 *
 * onModuleInit reproduces index.ts:174-179 EXACTLY: ensureIndexes() then
 * seedIfEmpty() inside ONE non-fatal try/catch that warn-logs and continues —
 * a startup failure must NOT crash the process (parity with the Express
 * "warn and continue on failure" comment). No silent ?? [] narrowing: the
 * original reads err.message unconditionally, so we mirror that exact shape.
 */
@Injectable()
export class AdDataService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    // Initialize ad system (non-fatal: warn and continue on failure).
    // Mirrors index.ts try/catch around ensureIndexes() + seedIfEmpty().
    try {
      await ensureIndexes();
      await seedIfEmpty();
    } catch (err) {
      logger.warn(
        { err: (err as { message?: string }).message },
        "[ad] Startup initialization failed",
      );
    }
  }

  getPlacements(): Promise<PlacementMap | Record<Placement, AdItem>> {
    return getPlacements();
  }
}
