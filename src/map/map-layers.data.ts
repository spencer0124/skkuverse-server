import { ESKARA26_LAYERS, type Eskara26LayerId } from "./map-eskara26-markers.data";

/**
 * The layer catalogue: every layer id this server can serve, and the facts
 * about each that do not depend on a language or on a request.
 *
 * Split out of `map-config.data.ts` for one concrete reason: chips reference
 * layer ids, and `map-chips.data.ts` has to resolve a chip's `layerIds` to a
 * `chipGroupId` to validate it. With the catalogue inside the response builder
 * that would be a runtime import cycle. Here both modules depend on this one
 * and neither depends on the other.
 *
 * Labels are NOT here. They are `t("map.layer.<id>", lang)`, resolved per
 * request in `map-config.data.ts`, which is the same split
 * `ESKARA26_LAYERS` already uses.
 */

/**
 * The drawing knobs a layer may set, and the client's fallback if it does not.
 *
 * Every member is optional and every one has a client-side default, so an old
 * server that sends none of them renders exactly as it does today. This is the
 * marker geometry the app used to hardcode — `DOT_SIZE`, `PIN_WIDTH`,
 * `PIN_HEIGHT`, the caption sizes and the label layer's z-index all lived as
 * constants in `MapMarkerLayer.tsx`, which meant changing how a marker looks
 * was an app release.
 *
 * ⚠️ COLOUR IS DELIBERATELY NOT MOVED for the building layers. The number
 * circle's fill and the placeDot's tint fall back to `SdsColors.brand`, a
 * design token that resolves per theme; a hex from here cannot. Geometry is
 * theme-independent and belongs on the wire, colour that comes from a token
 * does not. The festival layers do send `color`, because a category colour
 * (주점 red, 먹거리 amber) is content rather than theme.
 */
export interface MapLayerStyle {
  /** Bare hex, no `#` — the convention `toCssColor` expects. */
  color?: string;
  outlineColor?: string;
  /** Pin width in points. Was `PIN_WIDTH`. */
  width?: number;
  /** Pin height in points. Was `PIN_HEIGHT`. */
  height?: number;
  /** Circle diameter in points. Was `DOT_SIZE`. */
  size?: number;
  captionTextSize?: number;
  /** Draw order against other overlays. Was the label layer's `globalZIndex`. */
  zIndex?: number;
}

export interface LayerSpec {
  id: string;
  type: "marker" | "polyline";
  markerStyle?: string;
  /** Is the layer on to begin with. */
  defaultVisible: boolean;
  /**
   * May the user change it. See `docs/reference/map-markers-api.md` §4 for the
   * four combinations and the three contract rules; the one that matters to
   * chips is that this governs the affordance, not the capability.
   */
  userConfigurable: boolean;
  endpoint: string;
  /**
   * Which exclusivity group a chip may swap this layer within, or `null` for a
   * layer no chip may ever change.
   *
   * Declared rather than inferred. The obvious shortcut is to read the group
   * off `endpoint` — layers sharing a data source already share a URL, so today
   * the two agree exactly. But `endpoint` is a CACHE key: the app keys its
   * marker query on that string so two building layers cost one fetch. Merging
   * or splitting a route for network reasons would then silently redraw the
   * chip boundaries, and the symptom — "tapping 무대 hid 건물번호" — would have
   * no line of code to blame.
   *
   * This is the shape the GIS tools settled on: Leaflet's grouped layer control
   * takes an explicit `exclusiveGroups` option naming which groups behave like
   * radio buttons, and ArcGIS service metadata carries an `EXCLUSIVE=TRUE` flag
   * on a group description. In both, group membership and exclusivity are
   * properties of the layer, kept separate from where the layer's data comes
   * from.
   *
   * `null` is the meaningful default, not an absence: it is how the building
   * layers stay visible and stay user-toggleable while a festival chip swaps
   * the festival layers around them.
   */
  chipGroupId: string | null;
  style?: MapLayerStyle;
}

/** The one festival group. Named here so the chips and the layers cannot drift. */
export const ESKARA26_CHIP_GROUP = "eskara26";

/**
 * The layers that exist regardless of whether a festival is live.
 *
 * One list, `as const satisfies`, so the id union below is read off it rather
 * than restated — the same reason `ESKARA26_LAYERS` is shaped this way. A chip
 * naming a layer that does not exist is then a compile error.
 *
 * Both point at ONE endpoint. They are the same buildings differing only in
 * which field becomes the visible string, and the app keys its marker cache on
 * the endpoint — so this is two toggles for one fetch.
 *
 * `chipGroupId: null` on both: 건물번호 and 건물이름 are the map's baseline, and
 * a chip that jumps to a festival stage has no business turning them off.
 */
export const BASE_LAYERS = [
  {
    id: "building_numbers",
    type: "marker",
    markerStyle: "numberCircle",
    defaultVisible: true,
    userConfigurable: true,
    endpoint: "/map/markers/campus",
    chipGroupId: null,
    style: { size: 16 },
  },
  {
    id: "building_labels",
    type: "marker",
    markerStyle: "textLabel",
    defaultVisible: true,
    userConfigurable: true,
    endpoint: "/map/markers/campus",
    chipGroupId: null,
    // The label layer draws above every other overlay so a building name is
    // never hidden behind a booth pin.
    style: { captionTextSize: 7, zIndex: 100000 },
  },
  // {
  //   id: "bus_route_jongro07",
  //   type: "polyline",
  //   defaultVisible: true,
  //   userConfigurable: true,
  //   endpoint: "/map/overlays/jongro07",
  //   chipGroupId: null,
  //   style: { color: "4CAF50" },
  // },
  // {
  //   id: "bus_route_jongro02",
  //   type: "polyline",
  //   defaultVisible: true,
  //   userConfigurable: true,
  //   endpoint: "/map/overlays/jongro02",
  //   chipGroupId: null,
  //   style: { color: "4CAF50" },
  // },
] as const satisfies readonly LayerSpec[];

/** Geometry shared by every festival layer; only `color` varies between them. */
export const ESKARA26_LAYER_STYLE = {
  width: 22,
  height: 30,
  captionTextSize: 9,
} as const satisfies MapLayerStyle;

export type BaseLayerId = (typeof BASE_LAYERS)[number]["id"];

/**
 * Every layer id the server can serve, festival ones included.
 *
 * Festival layers are in the union even though they are absent from
 * `/map/config` outside an activation window. A chip referencing one is
 * correct year-round — it simply is not served alongside the layer it names —
 * so gating the TYPE on the runtime window would make a valid chip
 * unexpressible.
 */
export type MapLayerId = BaseLayerId | Eskara26LayerId;

/**
 * id → chipGroupId, for every layer, festival ones included.
 *
 * Built from the two lists rather than written out, so a layer cannot be added
 * to a list and forgotten here — which is the failure the "one list" rule in
 * `map-eskara26-markers.data.ts` exists to prevent.
 */
const CHIP_GROUP_BY_LAYER: ReadonlyMap<string, string | null> = new Map<
  string,
  string | null
>([
  ...BASE_LAYERS.map(
    (layer) => [layer.id, layer.chipGroupId] as [string, string | null],
  ),
  ...ESKARA26_LAYERS.map(
    (layer) => [layer.id, ESKARA26_CHIP_GROUP] as [string, string | null],
  ),
]);

/**
 * The group a chip may swap this layer within.
 *
 * Returns `undefined` for an id that is not a layer at all, which is a
 * different failure from `null` ("real layer, no chip may touch it") and is
 * reported differently by the chip validator.
 */
export function chipGroupOf(layerId: string): string | null | undefined {
  return CHIP_GROUP_BY_LAYER.get(layerId);
}
