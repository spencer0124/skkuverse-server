import { Injectable } from "@nestjs/common";
import * as registry from "./miniapps";
import type { MiniAppDetail, MiniAppIndexEntry } from "./types";

/**
 * MiniAppsService — thin @Injectable delegate over the validated registry
 * module (frozen ordered list + Map loaded from index.json / details/*.json).
 *
 * Mirrors SourcesService: the freeze, the JSON load, the WEB_ORIGIN logo
 * resolution, and the boot-time integrity check all happen in the delegated
 * module. This wrapper adds no defaults and no narrowing.
 */
@Injectable()
export class MiniAppsService {
  /** Registry schema version (MINIAPP_REGISTRY_VERSION on the wire). */
  get version(): number {
    return registry.version;
  }

  /** Frozen index ordered by `order`, logos resolved to absolute URLs. */
  get list(): ReadonlyArray<Readonly<MiniAppIndexEntry>> {
    return registry.list;
  }

  /** Frozen id → detail map for O(1) lookups. */
  get map(): ReadonlyMap<string, Readonly<MiniAppDetail>> {
    return registry.map;
  }

  /** Detail for a slug, or undefined when unregistered. */
  getDetail(id: string): Readonly<MiniAppDetail> | undefined {
    return registry.map.get(id);
  }
}
