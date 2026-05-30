import { Injectable } from "@nestjs/common";
import { recordEvent } from "../../features/ad/ad.stats";
import type { AdEventType, Placement } from "../../features/ad/types";

/**
 * AdStatsService — thin @Injectable wrapper over features/ad/ad.stats
 * recordEvent. The adId hex validation happens in the controller (24-hex regex,
 * matching ad.routes.ts); recordEvent itself is intentionally fail-loud (an
 * invalid adId would make `new ObjectId(adId)` throw → 500), so we forward
 * verbatim with no extra try/catch.
 */
@Injectable()
export class AdStatsService {
  recordEvent(
    placement: Placement,
    event: AdEventType,
    adId: string | null,
  ): Promise<void> {
    return recordEvent(placement, event, adId);
  }
}
