import type { EventMapConfig } from "./map-layerset.types";
import { pick } from "../infra/i18n";
import type { I18n, SupportedLang } from "../infra/types";
import { toWebviewUrl } from "../infra/webview-url";
import type { MapCamera, MapChip, MapChipAction } from "./map-chip.types";
import { BASE_LAYERS, chipGroupOf, type LayerSpec } from "./map-layers.data";

/**
 * The chips `/map/config` advertises, and the rules a chip must satisfy to be
 * served at all.
 *
 * Two sources, one validator. `BASE_CHIPS` is repo config, checked at import
 * against `BASE_LAYERS` so a bad permanent chip fails the boot. A festival's
 * chips are authored in its config (`EventChipDef`) and projected here by
 * `eventChipSpecs`; `map-layerset.config.ts` runs the SAME validator over them at
 * load, against the full served catalogue, so a bad festival chip fails the
 * config — logged and skipped, taking the festival off the campus map — rather
 * than reaching a client. That is the `miniapps.schema.ts` posture for the base
 * list and the marker projection's for the festival list: fail loud where a PR
 * fixes it, fail soft where 건물번호 can keep serving without it.
 *
 * This module imports only the event map's TYPES. It must never import
 * `map-layerset.config` — that module imports this one — and `eslint.config.js`
 * enforces exactly that for this file, so the rule is not prose.
 */

/** The authored form of `MapChipAction`, before URL resolution. */
export type MapChipActionSpec =
  | { kind: "webview"; url: string }
  | {
      kind: "focus";
      camera: MapCamera;
      /**
       * Plain strings. The compile-time `MapLayerId` union went with the TS
       * festival catalogue; both lists are now validated at runtime against the
       * catalogue actually served, which is the only check that can also cover
       * a config-authored chip.
       */
      layerIds: readonly string[];
    };

export interface MapChipSpec {
  id: string;
  /** Tossface emoji, the mark the app's chip primitive already renders. */
  emoji: string;
  /** Every language we hold, resolved per request with the event map's `pick`. */
  label: I18n;
  action: MapChipActionSpec;
  /** See `MapChip.isReset`. Only the synthesised reset chip carries `true`. */
  isReset: boolean;
}

/**
 * Chips that exist whether or not a festival is live.
 *
 * EMPTY on purpose, so off-season the map serves no chip row at all — the
 * client renders nothing rather than an empty scroller. It is a list and not a
 * deleted concept because a permanent chip is an ordinary thing to want back,
 * and `getChips` already concatenates it.
 *
 * 분실물 lived here and was removed. The feature is not gone with it: the
 * campus SDUI still carries a `lost_found` quick action
 * (`src/ui/ui/ui.campus.ts`) pointing at the same page, so the chip was a
 * second door to a room that still has one.
 *
 * Whatever lands here next, a webview URL is authored ROOT-RELATIVE.
 * `toWebviewUrl` joins it onto `WEBVIEW_ORIGIN` at serve time, so nobody types
 * a host in this file — which matters because the webview URLs this API emits
 * sat as literals until they all had to move at once.
 */
export const BASE_CHIPS: readonly MapChipSpec[] = [];

/**
 * Every rule a chip must satisfy, checked against the catalogue it will be
 * served beside, and reported together.
 *
 * Errors accumulate rather than throwing on the first one, so a bad edit is
 * fixed in a single pass instead of one boot per mistake — the shape
 * `tabconfig.service.ts` uses for the same reason. Returned rather than thrown
 * because the two callers want different failures: the import-time check on
 * `BASE_CHIPS` is fatal, the config-load check on a festival's chips rejects the
 * config and leaves the base map serving.
 */
export function validateChipSpecs(
  specs: readonly MapChipSpec[],
  catalogue: readonly LayerSpec[],
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const spec of specs) {
    if (seen.has(spec.id)) errors.push(`duplicate chip id "${spec.id}"`);
    seen.add(spec.id);

    if (spec.action.kind === "webview") {
      // The one web view URL rule, shared with the event map's sheet buttons and
      // the mini-app registry. Not re-implemented here: a second copy is how the
      // backslash-escape gap ended up needing closing twice.
      if (toWebviewUrl(spec.action.url) === null) {
        errors.push(
          `chip "${spec.id}": "${spec.action.url}" is not a usable web view URL`,
        );
      }
      continue;
    }

    const groups = new Set<string>();
    for (const layerId of spec.action.layerIds) {
      const group = chipGroupOf(catalogue, layerId);
      if (group === undefined) {
        errors.push(`chip "${spec.id}": "${layerId}" is not a layer`);
        continue;
      }
      if (group === null) {
        // The rule the building layers exist to exercise: a chip tap is a
        // user-initiated change, and this layer is not the user's to change.
        errors.push(
          `chip "${spec.id}": layer "${layerId}" has chipGroupId null, so no chip may change it`,
        );
        continue;
      }
      groups.add(group);
    }

    if (groups.size > 1) {
      errors.push(
        `chip "${spec.id}": layerIds straddle chip groups ${[...groups].sort().join(", ")} — a chip's exclusivity scope must be one group`,
      );
    }
  }

  return errors;
}

/** The fatal form, for repo config that a PR fixes. */
export function assertValidChipSpecs(
  specs: readonly MapChipSpec[],
  catalogue: readonly LayerSpec[],
): void {
  const errors = validateChipSpecs(specs, catalogue);
  if (errors.length > 0) {
    throw new Error(
      `FATAL [map chips]: ${errors.length} invalid chip definition(s):\n  - ${errors.join("\n  - ")}`,
    );
  }
}

// Runs at import, so an invalid base chip aborts the boot rather than surfacing
// on the first /map/config request. Festival chips are checked at config load.
assertValidChipSpecs(BASE_CHIPS, BASE_LAYERS);

/**
 * The way back, synthesised rather than authored.
 *
 * It is scoped to the layers that come on by THEMSELVES — always-on plus
 * scheduled — without touching 건물번호 or 건물이름. A layer that ships opt-in
 * (편의시설) stays out of it: naming every layer would make "축제 전체" reach
 * something the user never opted into and leave no chip that gets back to the
 * ordinary festival map. A scheduled layer belongs in the set precisely because
 * it comes on by itself when its window opens.
 *
 * `isReset` carries the meaning, and `layerIds` keeps carrying the SCOPE. The
 * two are not redundant: `layerIds` is how any chip declares which group it may
 * change, and emptying it here would leave this chip with no group at all — so
 * a second festival's reset chip could not be told from this one's. What
 * `layerIds` can no longer do is describe the resulting VIEW, because a
 * scheduled layer's default depends on the time of day and only the client
 * knows what time it is.
 *
 * Deriving it here from the config is what makes drift impossible: a second
 * hand-written list of the same ids is exactly the parallel structure that
 * quietly stops turning one category back on. The label is the festival's own
 * name, so the reset chip reads as the brand rather than as a category.
 */
export function resetChip(config: EventMapConfig): MapChipSpec {
  return {
    id: `${config.layerSetId}_all`,
    emoji: config.emoji,
    label: { ...config.name },
    action: {
      kind: "focus",
      camera: { ...config.camera },
      layerIds: config.layers
        .filter((layer) => layer.defaultVisibleWhen.kind !== "never")
        .map((layer) => layer.id),
    },
    isReset: true,
  };
}

/**
 * The live festival's chip row: the reset chip first, then every authored chip.
 *
 * Each authored chip is one tap for what otherwise costs opening the filter
 * sheet and toggling several things. A chip that names exactly one layer and
 * authored no label reads as that layer does — `map-layerset.config.ts` refuses a
 * wider chip without one. Every chip shares the config's camera.
 *
 * Fresh objects per call: the config is frozen shallowly and shared across
 * every request, so nothing built from it may reach a response by reference.
 */
export function eventChipSpecs(config: EventMapConfig): MapChipSpec[] {
  const layerById = new Map(config.layers.map((layer) => [layer.id, layer]));
  const authored = config.chips.map((chip): MapChipSpec => ({
    id: chip.id,
    emoji: chip.emoji,
    // The `?? { ko: chip.id }` is unreachable after assertValidConfig — a chip
    // with no label names exactly one existing layer — and exists to keep the
    // type honest, the same shape `toWireAction` uses below.
    label: { ...(chip.label ?? layerById.get(chip.layerIds[0] ?? "")?.label ?? { ko: chip.id }) },
    action: {
      kind: "focus",
      camera: { ...config.camera },
      layerIds: [...chip.layerIds],
    },
    // An authored chip narrows; only the synthesised one undoes it. Stated
    // rather than left absent, so the wire carries no optional field.
    isReset: false,
  }));
  return [resetChip(config), ...authored];
}

function toWireAction(action: MapChipActionSpec): MapChipAction {
  if (action.kind === "webview") {
    // The `??` is unreachable — the validator already ran toWebviewUrl on this
    // exact value — and exists to keep the type honest, the same shape
    // `resolveActions` uses next door.
    return { kind: "webview", url: toWebviewUrl(action.url) ?? action.url };
  }
  return {
    kind: "focus",
    camera: { ...action.camera },
    layerIds: [...action.layerIds],
  };
}

/**
 * The chips to serve, with labels resolved.
 *
 * The live event's config is passed in rather than looked up here so that one
 * `/map/config` request costs one activation read, shared with the layer list.
 * It also keeps this module free of a database dependency, which is what lets
 * the chip tests run without mocking Mongo.
 */
export function getChips(lang: SupportedLang, event: EventMapConfig | null): MapChip[] {
  const specs: readonly MapChipSpec[] = event
    ? [...BASE_CHIPS, ...eventChipSpecs(event)]
    : BASE_CHIPS;

  return specs.map((spec) => ({
    id: spec.id,
    // `?? spec.id` is unreachable — `ko` is required and non-blank on every
    // authored label — and keeps the type honest.
    label: pick(spec.label, lang) ?? spec.id,
    icon: { kind: "emoji", emoji: spec.emoji },
    action: toWireAction(spec.action),
    isReset: spec.isReset,
  }));
}
