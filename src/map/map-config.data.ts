import { activeEventConfig } from "../eventmap/eventmap.active";
import type { EventMapConfig } from "../eventmap/types";
import config from "../infra/config";
import { pick, t } from "../infra/i18n";
import logger from "../infra/logger";
import type { SupportedLang } from "../infra/types";
import type { CameraMotion, MapChip } from "./map-chip.types";
import { getChips } from "./map-chips.data";
import { BASE_LAYERS, eventLayerSpecs, type LayerSpec } from "./map-layers.data";

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

/**
 * A layer as served: the spec with its label resolved to the requested
 * language. DERIVED from `LayerSpec` rather than restated, so a member added
 * there reaches both the wire (through the `...rest` spread below) and this
 * declared type in one edit — a hand-copied interface let the spread ship a
 * field the type did not admit, with tsc green. The contract prose for each
 * member, the four `userConfigurable` rules included, lives on `LayerSpec`.
 */
type LayerEntry = Omit<LayerSpec, "label"> & { label: string };

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
 * The live festival's config, or `null` for "no festival".
 *
 * Contained on purpose. Until the event layers existed /map/config could not
 * fail — no DB dependency at all — and the app's fallback for a failed config
 * is a bundled default holding no booth layers but also no BUILDING layers.
 * Letting a Mongo hiccup here take 건물번호 down with it would trade a missing
 * festival for a blank campus map, so a failure answers "no festival" and the
 * route keeps the never-fails property it had when it was sync. A live
 * activation whose config this build cannot use answers the same way, and
 * `activeEventConfig` has already said so once in the log.
 *
 * Called ONCE per request and handed to both the layer list and the chip list.
 * Asking separately would be two reads for one answer, and — worse — the two
 * could disagree if the window closed between them, serving chips that point at
 * layers no longer in the same response.
 */
async function activeEvent(): Promise<EventMapConfig | null> {
  try {
    return await activeEventConfig(new Date());
  } catch (err) {
    logger.warn(
      `[map] event layer lookup failed, serving base layers only: ${String(err)}`,
    );
    return null;
  }
}

/**
 * Returns map layer configuration with campus definitions.
 * Text fields are resolved to the requested language via i18n.
 */
async function getMapConfig(lang: SupportedLang = "ko"): Promise<MapConfigResponse> {
  const event = await activeEvent();
  const layerSpecs: readonly LayerSpec[] = event
    ? [...BASE_LAYERS, ...eventLayerSpecs(event)]
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
      // booths with tsc green.
      //
      // `label` is DESTRUCTURED OUT and re-added resolved: left in `rest` the
      // `{ko, en, zh}` object would ride to the wire and render as
      // "[object Object]". Labels are resolved here because they are the only
      // per-request part of a layer; the `?? id` is unreachable — `ko` is
      // required on every spec — and keeps the type honest.
      ...layerSpecs.map(({ id, type, markerStyle, label, ...rest }) => ({
        id,
        type,
        markerStyle,
        label: pick(label, lang) ?? id,
        ...rest,
      })),
    ],
    chips: getChips(lang, event),
    cameraDefaults: {
      markerFocus: { zoom: 17.5, tilt: 0, bearing: 0, durationMs: 500 },
      campusFocus: { durationMs: 500 },
    },
  };
}

export { getMapConfig };
