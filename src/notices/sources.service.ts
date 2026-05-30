import { Injectable } from "@nestjs/common";
import * as sources from "./sources";
import type { SourceConfig } from "./types";

/**
 * SourcesService — thin @Injectable delegate over the validated
 * sources module (frozen list + Map loaded from sources.json).
 *
 * Exposes the same frozen `list` and `map` so the controller's
 * `sources.map.has(sourceId)` INVALID_SOURCE_ID guard and any source-metadata
 * passthrough stay byte-identical. The freeze + JSON load happen in the
 * delegated module; this wrapper adds no defaults or narrowing.
 */
@Injectable()
export class SourcesService {
  /** Frozen, ordered source-config list (from sources.json). */
  get list(): ReadonlyArray<Readonly<SourceConfig>> {
    return sources.list;
  }

  /** Frozen sourceId → SourceConfig map for O(1) lookups. */
  get map(): ReadonlyMap<string, Readonly<SourceConfig>> {
    return sources.map;
  }
}
