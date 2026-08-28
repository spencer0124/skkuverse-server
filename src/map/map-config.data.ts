import { findActiveActivation } from "../eventmap/eventmap.data";
import config from "../infra/config";
import { t } from "../infra/i18n";
import logger from "../infra/logger";
import type { SupportedLang } from "../infra/types";
import type { CameraMotion, MapChip } from "./map-chip.types";
import { getChips } from "./map-chips.data";
import {
  BASE_LAYERS,
  ESKARA26_LAYER_SPECS,
  type LayerSpec,
  type MapLayerStyle,
} from "./map-layers.data";

interface CampusEntry {
  id: "hssc" | "nsc";
  label: string;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  /**
   * Camera attitude for this campus.
   *
   * Both are 0 — straight down, north up — which is what the map already shows.
   * They are on the wire because the client has always PARSED them and the
   * server has never SENT them, so `CampusDef.defaultTilt` has been a field
   * that could only ever hold its own fallback. Sending them makes the campus
   * camera configurable from here, the same way a chip's is.
   */
  defaultTilt: number;
  defaultBearing: number;
  /**
   * How far from the centre still counts as being on this campus, in metres.
   *
   * The app compares its camera centre against this to tell whether the map and
   * the campus toggle are looking at the same place, and offers to reconcile
   * them when they are not.
   *
   * Derived from the marker data this same service returns rather than picked:
   * across both campus overlays the furthest building sits 460m from the 인사캠
   * centre and 487m from the 자과캠 one, while the two centres are 32,692m
   * apart. 1000m therefore covers a campus and its surroundings with room to
   * spare and is 3% of the distance between them, so the two circles cannot
   * overlap and "which campus" is never ambiguous.
   *
   * Old clients ignore this field, and clients newer than this deploy fall back
   * to the same number when a server does not send it.
   */
  radiusM: number;
}

interface LayerEntry {
  id: string;
  type: "marker" | "polyline";
  markerStyle?: string;
  label: string;
  /** Is the layer on to begin with. */
  defaultVisible: boolean;
  /**
   * May the user change it.
   *
   * Two independent axes: `defaultVisible` is what the value IS,
   * `userConfigurable` is who may change it — the shape Firefox ships as
   * `{Value, Status}` and GeoServer as `enabled`/`advertised`. The four
   * combinations are: always-on background (true/false), ordinary toggle
   * (true/true), opt-in (false/true), and defined-but-inert (false/false).
   *
   * Four rules the client must hold. They are the same four as
   * `docs/reference/map-markers-api.md` §4.1 — that document is the contract,
   * and this list must not disagree with it:
   *
   *  - **An ABSENT value means `true`.** Never fail closed — GeoServer's "a
   *    layer is advertised by default" and Esri's `listMode` default of "show".
   *    The server's own list is explicit anyway, so a new layer cannot forget
   *    to decide.
   *  - **It governs the affordance, not the capability.** A non-configurable
   *    layer still renders, is still deep-linkable, and is still returned by
   *    its marker endpoint. Only the control disappears. QGIS says it outright:
   *    flags are "used for the UI but are not preventing any API call."
   *  - **Shadow a stored toggle, never overwrite it.** The resolution is a
   *    fallback chain, not an assignment, so a preference survives the layer
   *    becoming non-configurable and comes back when it becomes configurable
   *    again. This is the one that destroys user data if you get it wrong.
   *  - **A chip may not change it either.** A chip tap is a user-initiated
   *    change, so `false` here puts the layer out of a chip's reach as well as
   *    out of the sheet's. Inert today — nothing is `false` — and stated now so
   *    it holds when the quadrant gets its first occupant.
   */
  userConfigurable: boolean;
  endpoint: string;
  /** See `map-layers.data.ts`: declared group, never inferred from `endpoint`. */
  chipGroupId: string | null;
  style?: MapLayerStyle;
}

interface MapConfigResponse {
  naver: { styleId: string | undefined };
  campuses: CampusEntry[];
  layers: LayerEntry[];
  chips: MapChip[];
  /**
   * Camera settings for the moves the app makes on its own, as opposed to the
   * ones a chip asks for.
   *
   * These were constants in the app — `zoom: 17.5` and `duration: 500`,
   * repeated at three call sites — which meant a chip's camera and a marker-tap
   * camera were configured in two different places and could disagree about how
   * close "close" is.
   */
  cameraDefaults: {
    /** Focusing a tapped marker, a search result, or a deep link. */
    markerFocus: CameraMotion;
    /**
     * Switching campus. Only the duration lives here: the zoom, tilt and
     * bearing are per-campus and already sit on the `CampusEntry`.
     */
    campusFocus: { durationMs: number };
  };
}

/**
 * Is a festival live right now?
 *
 * Contained on purpose. Until the event layers existed /map/config could not
 * fail — no DB dependency at all — and the app's fallback for a failed config
 * is a bundled default holding no booth layers but also no BUILDING layers.
 * Letting a Mongo hiccup here take 건물번호 down with it would trade a missing
 * festival for a blank campus map, so a failure answers "no festival" and the
 * route keeps the never-fails property it had when it was sync.
 *
 * Called ONCE per request and handed to both the layer list and the chip list.
 * Asking separately would be two reads for one answer, and — worse — the two
 * could disagree if the window closed between them, serving chips that point at
 * layers no longer in the same response.
 */
async function isFestivalLive(): Promise<boolean> {
  try {
    return (await findActiveActivation(new Date())) !== null;
  } catch (err) {
    logger.warn(
      `[map] event layer lookup failed, serving base layers only: ${String(err)}`,
    );
    return false;
  }
}

/**
 * Returns map layer configuration with campus definitions.
 * Text fields are resolved to the requested language via i18n.
 */
async function getMapConfig(lang: SupportedLang = "ko"): Promise<MapConfigResponse> {
  const festivalLive = await isFestivalLive();
  const layerSpecs: readonly LayerSpec[] = festivalLive
    ? [...BASE_LAYERS, ...ESKARA26_LAYER_SPECS]
    : BASE_LAYERS;

  return {
    naver: { styleId: config.naver.styleId },
    campuses: [
      {
        id: "hssc",
        label: t("map.campus.hssc.label", lang),
        centerLat: 37.587241,
        centerLng: 126.992858,
        defaultZoom: 15.8,
        defaultTilt: 0,
        defaultBearing: 0,
        radiusM: 1000,
      },
      {
        id: "nsc",
        label: t("map.campus.nsc.label", lang),
        centerLat: 37.29358,
        centerLng: 126.974942,
        defaultZoom: 15.8,
        defaultTilt: 0,
        defaultBearing: 0,
        radiusM: 1000,
      },
    ],
    layers: [
      // ONE mapping over both sets, and `...rest` rather than a field-by-field
      // copy, so a member added to LayerSpec reaches the wire without an edit
      // here. The festival six used to be built separately, which meant a new
      // member shipped on the buildings and was silently missing from the
      // booths with tsc green. Naming the first three fields only puts `label`
      // in a readable position.
      //
      // The catalogue itself lives in map-layers.data so chips can resolve a
      // layer's group without importing this response builder; labels are
      // resolved here because they are the only per-request part of a layer.
      ...layerSpecs.map(({ id, type, markerStyle, ...rest }) => ({
        id,
        type,
        markerStyle,
        label: t(`map.layer.${id}`, lang),
        ...rest,
      })),
    ],
    chips: getChips(lang, festivalLive),
    cameraDefaults: {
      markerFocus: { zoom: 17.5, tilt: 0, bearing: 0, durationMs: 500 },
      campusFocus: { durationMs: 500 },
    },
  };
}

export { getMapConfig };
