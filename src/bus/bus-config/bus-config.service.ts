import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import {
  getBusGroups,
  computeEtag,
  getGroupById,
  computeGroupEtag,
} from "./bus-config.data";

export type BusGroup = ReturnType<typeof getBusGroups>[number];

/**
 * SDUI bus-group config + ETags — DELEGATES to features/bus/bus-config.data
 * (read-only shared import). This is the single most important parity lever:
 * getBusGroups/computeEtag produce ETags via JSON.stringify with exact field
 * ordering, and the per-lang etagCache lives in the original module. Importing
 * + calling guarantees byte-identical ETag strings and group bytes — NO
 * reimplementation.
 */
@Injectable()
export class BusConfigService {
  getBusGroups(lang: SupportedLang = "ko"): BusGroup[] {
    return getBusGroups(lang);
  }

  computeEtag(lang: SupportedLang = "ko"): string {
    return computeEtag(lang);
  }

  getGroupById(id: string, lang: SupportedLang = "ko"): BusGroup | null {
    return getGroupById(id, lang);
  }

  computeGroupEtag(id: string, lang: SupportedLang = "ko"): string | null {
    return computeGroupEtag(id, lang);
  }
}
