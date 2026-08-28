import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";
import { toWebviewUrl } from "../infra/webview-url";
import type { MapCamera, MapChip, MapChipAction } from "./map-chip.types";
import { ESKARA26_LAYERS } from "./map-eskara26-markers.data";
import { chipGroupOf, type MapLayerId } from "./map-layers.data";

/**
 * The chips `/map/config` advertises, and the rules a chip must satisfy to be
 * served at all.
 *
 * Authored here as TypeScript rather than as ops data in Mongo, for the same
 * reason the layer list is: a chip names layer ids, and a TypeScript literal
 * checked against `MapLayerId` turns a typo into a compile error instead of a
 * button that does nothing. That costs a deploy to change a chip. Festival
 * chips get the deploy-free lever anyway by riding the activation window, which
 * is the part that actually has to move during an event.
 *
 * Everything else is validated at module load and THROWS, so a bad chip fails
 * the boot rather than reaching a client. That is the `miniapps.schema.ts`
 * posture, not the `eventmap.materialize.ts` one: these lists are repo config,
 * so a bad value is a bug a PR fixes, not a runtime contingency to render
 * around. Fail loud where you can fix it.
 */

/** The authored form of `MapChipAction`, before URL resolution. */
export type MapChipActionSpec =
  | { kind: "webview"; url: string }
  | {
      kind: "focus";
      camera: MapCamera;
      /**
       * Typed as `MapLayerId`, not `string`. This is the whole reason the layer
       * catalogue was split into its own module: a chip pointing at a layer
       * that does not exist must not compile.
       */
      layerIds: readonly MapLayerId[];
    };

export interface MapChipSpec {
  id: string;
  /** Tossface emoji, the mark the app's chip primitive already renders. */
  emoji: string;
  action: MapChipActionSpec;
}

/**
 * Chips that exist whether or not a festival is live.
 *
 * The URL is root-relative on purpose. `toWebviewUrl` joins it onto
 * `WEBVIEW_ORIGIN` at serve time, so nobody types a host here — which matters
 * because the four webview URLs this API emits sat as literals until they all
 * had to move at once.
 */
export const BASE_CHIPS = [
  {
    id: "lost_found",
    emoji: "🧳",
    action: { kind: "webview", url: "/skku/lostandfound" },
  },
] as const satisfies readonly MapChipSpec[];

/**
 * Where a festival chip points the camera.
 *
 * The NSC festival ground, the same point `eskara-2026.json` frames. It is
 * restated rather than imported, because the two are independent by design:
 * that one is where the EVENT MAP surface opens, this is where the CAMPUS map
 * jumps when someone taps 공연. Binding them would make a framing tweak on one
 * surface silently move the other.
 */
const ESKARA26_CAMERA = {
  lat: 37.295129,
  lng: 126.971234,
  zoom: 17.5,
  tilt: 0,
  bearing: 0,
  durationMs: 500,
} as const satisfies MapCamera;

/**
 * The festival layers that are on by default — what "축제 전체" restores.
 *
 * Deliberately NOT every festival layer. `eskara26_facility` ships
 * `defaultVisible: false`, so naming it here would make the reset chip turn on
 * a layer the user never opted into, and leave no chip that gets back to the
 * ordinary map. "전체" means the festival as it normally looks; 편의시설 has its
 * own chip for when it is wanted.
 *
 * Derived from the layer list rather than written out. A second hand-written
 * array of the same ids is the parallel structure the layer module warns about:
 * it drifts, and the drift shows up as a reset chip that quietly stops turning
 * one category back on.
 */
const DEFAULT_ESKARA26_LAYER_IDS: readonly MapLayerId[] = ESKARA26_LAYERS.filter(
  (layer) => layer.defaultVisible,
).map((layer) => layer.id);

/**
 * View presets for the festival, present only while one is live.
 *
 * Each is one tap for what otherwise costs opening the filter sheet and
 * toggling six things. `eskara26_view_all` is the way back: it restores the
 * festival's DEFAULT layer set — not literally every layer — without touching
 * 건물번호 or 건물이름.
 *
 * 편의시설 earns a chip precisely because its layer starts hidden — a chip is
 * how an opt-in layer becomes reachable without a trip through the sheet, and
 * why the reset chip can leave it out and still be a complete way back.
 */
export const ESKARA26_CHIPS = [
  {
    id: "eskara26_view_all",
    emoji: "🎪",
    action: { kind: "focus", camera: ESKARA26_CAMERA, layerIds: DEFAULT_ESKARA26_LAYER_IDS },
  },
  {
    id: "eskara26_view_stage",
    emoji: "🎤",
    action: { kind: "focus", camera: ESKARA26_CAMERA, layerIds: ["eskara26_stage"] },
  },
  {
    id: "eskara26_view_bar",
    emoji: "🍺",
    action: { kind: "focus", camera: ESKARA26_CAMERA, layerIds: ["eskara26_bar"] },
  },
  {
    id: "eskara26_view_food",
    emoji: "🍢",
    action: { kind: "focus", camera: ESKARA26_CAMERA, layerIds: ["eskara26_food"] },
  },
  {
    id: "eskara26_view_booth",
    emoji: "🎫",
    action: { kind: "focus", camera: ESKARA26_CAMERA, layerIds: ["eskara26_booth"] },
  },
  {
    id: "eskara26_view_facility",
    emoji: "🚻",
    action: { kind: "focus", camera: ESKARA26_CAMERA, layerIds: ["eskara26_facility"] },
  },
] as const satisfies readonly MapChipSpec[];

/**
 * Every rule a chip must satisfy, checked once and reported together.
 *
 * Errors accumulate rather than throwing on the first one, so a bad edit is
 * fixed in a single pass instead of one boot per mistake — the shape
 * `tabconfig.service.ts` uses for the same reason.
 */
export function validateChipSpecs(specs: readonly MapChipSpec[]): void {
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
      const group = chipGroupOf(layerId);
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

  if (errors.length > 0) {
    throw new Error(
      `FATAL [map chips]: ${errors.length} invalid chip definition(s):\n  - ${errors.join("\n  - ")}`,
    );
  }
}

// Runs at import, so an invalid chip aborts the boot rather than surfacing on
// the first /map/config request.
validateChipSpecs([...BASE_CHIPS, ...ESKARA26_CHIPS]);

function toWireAction(action: MapChipActionSpec): MapChipAction {
  if (action.kind === "webview") {
    // The `??` is unreachable — validateChipSpecs already ran toWebviewUrl on
    // this exact value at import — and exists to keep the type honest, the same
    // shape `resolveActions` uses next door.
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
 * `festivalLive` is passed in rather than looked up here so that one
 * `/map/config` request costs one activation read, shared with the layer list.
 * It also keeps this module free of a database dependency, which is what lets
 * the chip tests run without mocking Mongo.
 */
export function getChips(lang: SupportedLang, festivalLive: boolean): MapChip[] {
  const specs: readonly MapChipSpec[] = festivalLive
    ? [...BASE_CHIPS, ...ESKARA26_CHIPS]
    : BASE_CHIPS;

  return specs.map((spec) => ({
    id: spec.id,
    label: t(`map.chip.${spec.id}`, lang),
    icon: { kind: "emoji", emoji: spec.emoji },
    action: toWireAction(spec.action),
  }));
}
