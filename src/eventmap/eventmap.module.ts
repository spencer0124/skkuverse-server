import { Module } from "@nestjs/common";

import { EventMapService } from "./eventmap.service";

/**
 * EventMapModule — the event map storage layer (skkuverse#13, Phase 1).
 *
 * No controller and no middleware on purpose: nothing is served yet. The module
 * exists so EventMapService's onModuleInit runs at boot and creates the
 * collections' indexes. Phase 2 (#14) adds the /eventmap controller, the
 * internal publish route and its rate-limit / shared-secret wiring.
 */
@Module({
  providers: [EventMapService],
  exports: [EventMapService],
})
export class EventMapModule {}
