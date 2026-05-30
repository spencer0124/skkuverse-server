import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../infra/config";
import logger from "../infra/logger";
import { syncBuildings } from "./building.sync";
import { PollerRegistryService } from "../scheduling/poller-registry.service";

/**
 * BuildingSyncService — registers the existing building.sync
 * syncBuildings() (SKKU campusMap.do crawl → raw/enriched/spaces upsert) with
 * the Nest PollerRegistry, mirroring index.ts's
 * `import "./building.sync"` side-effect + lib/pollers
 * registration. Interval = config.building.syncIntervalMs (~7 days), name
 * "building-sync" — identical to the lib/pollers.registerPoller call at
 * building.sync.ts:504-514. The wrapper matches that call's .catch shape
 * ("[building-sync] Poller error") so log parity holds.
 *
 * Gating: PollerRegistryService.onApplicationBootstrap only startAll()s when
 * ROLE !== "api" (same as index.ts's poller startup), so an api replica
 * registers but never runs the sync — no duplicate crawls across replicas.
 *
 * IMPORTANT — no double-run: importing building.sync ALSO
 * triggers its dormant lib/pollers.registerPoller side-effect (building.sync.ts
 * :504). That registration lands in the LEGACY lib/pollers registry, which the
 * Nest app NEVER starts (main.ts/bootstrap never calls lib/pollers.startAll()).
 * Only THIS Nest PollerRegistry is driven, so syncBuildings() runs at most once
 * per tick from a single source. The dormant legacy registration is inert.
 */
@Injectable()
export class BuildingSyncService implements OnModuleInit {
  constructor(private readonly registry: PollerRegistryService) {}

  onModuleInit(): void {
    this.registry.registerPoller(
      () =>
        syncBuildings().catch((err: unknown) =>
          logger.error(
            { err: (err as { message?: string }).message },
            "[building-sync] Poller error",
          ),
        ),
      config.building.syncIntervalMs,
      "building-sync",
    );
  }
}
