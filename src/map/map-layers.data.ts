import type { EventMapConfig } from "../eventmap/types";
import type { I18n } from "../infra/types";

/**
 * The layer catalogue: every layer id this server can serve, and the facts
 * about each that do not depend on a language or on a request.
 *
 * Two sources feed it. `BASE_LAYERS` is repo config — the buildings, on every
 * day of the year. The festival layers are read from the live layer set's
 * config (`src/eventmap/config/<layerSetId>.json`) and projected here by
 * `eventLayerSpecs`, so next year's festival is a JSON file and Mongo content
 * with no TypeScript to touch. Both reach the wire through ONE mapping in
 * `map-config.data.ts`.
 *
 * Split out of `map-config.data.ts` for one concrete reason: chips reference
 * layer ids, and a chip's `layerIds` have to resolve to a `chipGroupId` to be
 * validated. With the catalogue inside the response builder that would be a
 * runtime import cycle — worse now that `eventmap.config.ts` validates a
 * festival's chips at load and so imports this module too. Here nothing
 * imports back: this file depends only on the event map's TYPES, and
 * `eslint.config.js` refuses a runtime import that would close the cycle.
 *
 * Labels ARE here now, as `{ko, en, zh}`, and resolved per request with the
 * event map's `pick` — the same resolver the festival layers go through. They
 * used to be `t("map.layer.<id>")` keys, which meant the base and festival
 * halves of one list resolved through two mechanisms, and a missing key echoed
 * itself back as the visible label because `t()` does that silently on a miss.
 */

/**
 * The drawing knobs a layer may set. Every member is optional, so a server that
 * sends none of them renders exactly as one that never had the field.
 *
 * ⚠️ THE GEOMETRY IS NOT HONOURED BY THE SHIPPED CLIENT YET. Today
 * `MapMarkerLayer.tsx` hardcodes `DOT_SIZE`, `PIN_WIDTH`/`PIN_HEIGHT` and the
 * label layer's `globalZIndex`, and its parser does not read `height` or
 * `zIndex` at all — only `color` and `captionTextSize` reach a component.
 * Editing `size` here therefore changes the wire and nothing on screen, with no
 * error on either side. These fields are a PROMISE about the wire until the
 * client stops hardcoding them; see `docs/reference/map-markers-api.md` §9.7,
 * which is the same shape §9.3 records for `userConfigurable`.
 *
 * ⚠️ COLOUR IS DELIBERATELY NOT MOVED for the building layers. The number
 * circle's fill and the placeDot's tint fall back to `SdsColors.brand`, a
 * design token that resolves per theme; a hex from here cannot. Geometry is
 * theme-independent and belongs on the wire, colour that comes from a token
 * does not. The festival layers do send `color`, because a category colour
 * (주점 red, 먹거리 amber) is content rather than theme — and it is authored in
 * the festival's config for exactly that reason.
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
  /**
   * Every language we hold, resolved per request in `map-config.data.ts`.
   *
   * Inline rather than an i18n key so that the base and festival halves of the
   * list go through ONE resolver — a `spec.label ? pick() : t()` chain would be
   * a second one — and so `tsc` refuses a layer with no label at all.
   */
  label: I18n;
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

/**
 * The layers that exist regardless of whether a festival is live.
 *
 * One list, `as const satisfies`, so the id union below is read off it rather
 * than restated. Both point at ONE endpoint. They are the same buildings
 * differing only in which field becomes the visible string, and the app keys
 * its marker cache on the endpoint — so this is two toggles for one fetch.
 *
 * `chipGroupId: null` on both: 건물번호 and 건물이름 are the map's baseline, and
 * a chip that jumps to a festival stage has no business turning them off. A
 * festival config may not reuse these ids either — `eventmap.config.ts`
 * refuses one that does, because the two lists are served side by side.
 */
export const BASE_LAYERS = [
  {
    id: "building_numbers",
    type: "marker",
    markerStyle: "numberCircle",
    label: { ko: "건물번호", en: "Building Numbers", zh: "建筑编号" },
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
    label: { ko: "건물이름", en: "Building Names", zh: "建筑名称" },
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
  //   label: { ko: "종로07 노선", en: "Jongro 07 Route", zh: "钟路07路线" },
  //   defaultVisible: true,
  //   userConfigurable: true,
  //   endpoint: "/map/overlays/jongro07",
  //   chipGroupId: null,
  //   style: { color: "4CAF50" },
  // },
  // {
  //   id: "bus_route_jongro02",
  //   type: "polyline",
  //   label: { ko: "종로02 노선", en: "Jongro 02 Route", zh: "钟路02路线" },
  //   defaultVisible: true,
  //   userConfigurable: true,
  //   endpoint: "/map/overlays/jongro02",
  //   chipGroupId: null,
  //   style: { color: "4CAF50" },
  // },
] as const satisfies readonly LayerSpec[];

export type BaseLayerId = (typeof BASE_LAYERS)[number]["id"];

/**
 * ONE route for every festival layer, whichever festival. The app keys its
 * marker cache on this string, so six layers cost one fetch and one cache
 * entry, each rendering the subset carrying its own `layerId`. Named for the
 * mechanism rather than the event, so next year's config changes no URL.
 */
export const EVENT_MARKERS_ENDPOINT = "/map/markers/event";

/**
 * Geometry shared by every festival layer, whichever festival. This is how a
 * `placeDot` is drawn — the map's business, not the event's — which is why it
 * is a constant here and not a field in the config. Only `color` varies, and
 * that one IS content, so it comes from the config.
 */
export const EVENT_LAYER_STYLE = {
  width: 22,
  height: 30,
  captionTextSize: 9,
} as const satisfies MapLayerStyle;

/**
 * The live festival's layers as ordinary `LayerSpec`s.
 *
 * Every one is the user's to turn off, 편의시설 included — that one merely
 * starts hidden, per its `defaultVisible`. Nothing in a festival set is a
 * locked background layer. The chip group is the layer set id, so two festivals
 * could never share one, and a chip swaps these layers between themselves while
 * leaving 건물번호 and 건물이름 exactly as the user left them.
 *
 * Fresh objects per call. The config is frozen shallowly and shared across
 * every request, so nothing built from it may hand a config object through to
 * a response by reference.
 */
export function eventLayerSpecs(config: EventMapConfig): LayerSpec[] {
  return config.layers.map((layer) => ({
    id: layer.id,
    type: "marker",
    markerStyle: "placeDot",
    label: layer.label,
    defaultVisible: layer.defaultVisible,
    userConfigurable: true,
    endpoint: EVENT_MARKERS_ENDPOINT,
    chipGroupId: config.layerSetId,
    style: { color: layer.color, ...EVENT_LAYER_STYLE },
  }));
}

/**
 * The group a chip may swap this layer within, looked up in the catalogue the
 * caller is validating against — the served set, base and festival together.
 *
 * Returns `undefined` for an id that is not a layer at all, which is a
 * different failure from `null` ("real layer, no chip may touch it") and is
 * reported differently by the chip validator.
 */
export function chipGroupOf(
  catalogue: readonly LayerSpec[],
  layerId: string,
): string | null | undefined {
  const layer = catalogue.find((l) => l.id === layerId);
  return layer ? layer.chipGroupId : undefined;
}
