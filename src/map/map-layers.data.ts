import type {
  EventMapConfig,
  LayerDefaultVisibility,
} from "./map-layerset.types";
import type { I18n } from "../infra/types";

/**
 * The layer catalogue: every layer id this server can serve, and the facts
 * about each that do not depend on a language or on a request.
 *
 * Two sources feed it. `BASE_LAYERS` is repo config — the buildings, on every
 * day of the year. The festival layers are read from the live layer set's
 * config (`src/map/config/<layerSetId>.json`) and projected here by
 * `eventLayerSpecs`, so next year's festival is a JSON file and Mongo content
 * with no TypeScript to touch. Both reach the wire through ONE mapping in
 * `map-config.data.ts`.
 *
 * Split out of `map-config.data.ts` for one concrete reason: chips reference
 * layer ids, and a chip's `layerIds` have to resolve to a `chipGroupId` to be
 * validated. With the catalogue inside the response builder that would be a
 * runtime import cycle — worse now that `map-layerset.config.ts` validates a
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
 * The MARKER geometry is honoured as of app `ced0352`: `width`, `height`,
 * `size` and `zIndex` all reach a component, so editing one here changes what
 * is on screen. What is still unread is the POLYGON set — `outlineWidth`,
 * `fillOpacity`, `minZoom`, `maxZoom` — whose consumer is the client's overlay
 * renderer; see `docs/reference/map-overlays-api.md` §9.7.
 *
 * ⚠️ THERE IS DELIBERATELY NO `shape` MEMBER. A place marker draws as a dot
 * and is promoted to a pin only when selected, and the CLIENT owns that
 * default: it reads an absent `style.shape` as `dotThenPin`, so every ESKARA
 * layer gets the behaviour by saying nothing. Adding the member and stamping
 * `"dotThenPin"` on the layers would freeze a default that is meant to move
 * with the app that draws it. If a future layer genuinely wants `"pin"` — a
 * handful of landmark markers, where a teardrop reads better and there is no
 * density to relieve — add the member AND send it on that one layer only.
 * Never spell a shape into `markerStyle`: that is a closed allowlist on the
 * client, and an unrecognised member falls through to the building-number
 * branch, which would draw every booth as a green numbered circle on any build
 * older than the value. Pinned by `__tests__/nest/map/map.service.test.ts`.
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
  /**
   * The layer's PRIMARY paint, in bare hex with no `#` — the convention
   * `toCssColor` expects.
   *
   * What it paints depends on the overlay: a marker's tint, a line's stroke, a
   * polygon's fill. One field rather than a `fillColor` beside it, because a
   * layer carrying both would leave one of them dead on every overlay it draws,
   * and "every combination must be meaningful" is the bar this file already
   * applies to `userConfigurable` and `defaultVisibleWhen`.
   */
  color?: string;
  /** A polygon's or path's outline. Ignored where there is no outline to draw. */
  outlineColor?: string;
  /**
   * Outline thickness in points.
   *
   * Needed because the client's polygon overlay defaults it to ZERO — an
   * unstyled polygon has no border at all — and because the app currently
   * derives `outlineColor ? 1 : 0`, a workaround that exists only because this
   * field did not.
   */
  outlineWidth?: number;
  /**
   * Fill alpha, 0–1.
   *
   * A requirement rather than a nicety: the client's polygon `color` defaults
   * to OPAQUE black, so a zone shipped without this hides the basemap under it.
   * Kept separate from `color` rather than widening the hex to eight digits,
   * because `isHex6` is one rule shared by the bus overlay and festival layer
   * colours, and an opacity is not a colour.
   */
  fillOpacity?: number;
  /**
   * Zoom bounds, inclusive of neither end by default.
   *
   * Building footprints and boundary lines are noise at campus-wide zoom and
   * detail up close, which is a property of the layer rather than of any one
   * overlay. Both map to the client overlay base props directly.
   */
  minZoom?: number;
  maxZoom?: number;
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
  /**
   * How a MARKER on this layer is drawn. Ignored by every other overlay kind.
   *
   * There is deliberately no `type` beside it. A layer used to name its
   * renderer, which meant the renderer was decided twice — once here and once
   * by the geometry — and the two could disagree with nothing to blame. The
   * overlay's own `kind` is now the single discriminant, which is also what
   * lets ONE layer draw pins, a zone and a route line together: turning on
   * 부스 can show all three, because the layer no longer constrains geometry.
   */
  markerStyle?: string;
  /**
   * Every language we hold, resolved per request in `map-config.data.ts`.
   *
   * Inline rather than an i18n key so that the base and festival halves of the
   * list go through ONE resolver — a `spec.label ? pick() : t()` chain would be
   * a second one — and so `tsc` refuses a layer with no label at all.
   */
  label: I18n;
  /**
   * WHEN the layer is on to begin with, and the client's LAST resort — a chip's
   * narrowing and the user's own toggle both outrank it.
   *
   * Three axes on a layer now, not two: this says *when*, `userConfigurable`
   * says *who* may change it, and *what* is no longer a separate flag because
   * it is this one's `kind`. The boolean that used to sit here could not
   * express 주점, which belongs to the evening on every day of the festival, and
   * a boolean beside a window list would have been able to hold combinations
   * that mean nothing — see `LayerDefaultVisibility`.
   *
   * The server does NOT evaluate it. Opening and closing times ride in the
   * payload and the device does the arithmetic against its own clock, which is
   * the same contract `/map/overlays/event` relies on to stay cacheable
   * (`map-overlays.controller.ts`).
   */
  defaultVisibleWhen: LayerDefaultVisibility;
  /**
   * May the user change it.
   *
   * Independent of `defaultVisibleWhen`: that one says WHEN the layer starts
   * on, this one says WHO may change it — the shape Firefox ships as
   * `{Value, Status}` and GeoServer as `enabled`/`advertised`. Both of its
   * values are meaningful against a layer that starts on and against one that
   * does not: always-on background, ordinary toggle, opt-in, and
   * defined-but-inert. That test — every combination meaningful — is exactly
   * what a boolean beside a window list would have failed, and why the WHEN
   * axis is one tagged field instead.
   *
   * Four rules the client must hold. They are the same four as
   * `docs/reference/map-overlays-api.md` §4.4 — that document is the contract,
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
 * ONE route for the permanent campus collection — buildings and hand-authored
 * geometry alike. Two layers over it cost one fetch, each rendering the subset
 * carrying its own `layerId`.
 */
export const CAMPUS_OVERLAYS_ENDPOINT = "/map/overlays/campus";

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
 * festival config may not reuse these ids either — `map-layerset.config.ts`
 * refuses one that does, because the two lists are served side by side.
 */
export const BASE_LAYERS = [
  {
    id: "building_numbers",
    markerStyle: "numberCircle",
    label: { ko: "건물번호", en: "Building Numbers", zh: "建筑编号" },
    defaultVisibleWhen: { kind: "always" },
    userConfigurable: true,
    endpoint: CAMPUS_OVERLAYS_ENDPOINT,
    chipGroupId: null,
    style: { size: 16 },
  },
  {
    id: "building_labels",
    markerStyle: "textLabel",
    label: { ko: "건물이름", en: "Building Names", zh: "建筑名称" },
    defaultVisibleWhen: { kind: "always" },
    userConfigurable: true,
    endpoint: CAMPUS_OVERLAYS_ENDPOINT,
    chipGroupId: null,
    // The label layer draws above every other overlay so a building name is
    // never hidden behind a booth pin.
    style: { captionTextSize: 7, zIndex: 100000 },
  },
  {
    id: "campus_geometry",
    label: { ko: "건물 외곽", en: "Building Outlines", zh: "建筑轮廓" },
    // DEFINED BUT INERT, deliberately, and this is the one layer here in that
    // quadrant — the combination `userConfigurable`'s contract calls out as
    // meaningful. It exists so `campus_shapes` documents have a `layerId` they
    // can legally name: the producer drops any shape whose layer is not in this
    // list, so without an entry the whole collection is unauthorable.
    //
    // Nothing is drawn yet because nobody has traced a footprint. When the
    // first geometry lands, this becomes visible by changing two fields —
    // `defaultVisibleWhen` to `always` and `userConfigurable` to `true`. Until
    // then it draws nothing and offers no toggle, rather than shipping a
    // control that does nothing.
    defaultVisibleWhen: { kind: "never" },
    userConfigurable: false,
    endpoint: CAMPUS_OVERLAYS_ENDPOINT,
    chipGroupId: null,
    // No `color`, for the reason the building layers have none: an outline
    // belongs to the base map, whose palette is a design token that resolves
    // per theme, and a hex from here cannot. The geometry knobs ARE sent,
    // because they are theme-independent — and `outlineWidth` in particular,
    // because the client's polygon overlay defaults it to 0 and would draw a
    // borderless blob without it.
    //
    // `minZoom` because footprints at campus-wide zoom are noise; the outlines
    // only mean anything once a building fills a useful part of the screen.
    style: { fillOpacity: 0.12, outlineWidth: 1.5, minZoom: 16 },
  },
  // The two commented-out bus route layers that used to sit here are gone. They
  // pointed at `/map/overlays/:overlayId`, which is deleted, and they described
  // themselves with a layer `type` that no longer exists. Reviving them is now
  // a different and better-shaped job: give the two jongro routes documents in
  // `campus_shapes` with LineString geometry pointing at the layer above, and
  // they arrive through the campus collection as ordinary `kind: "path"`
  // overlays with no second URL, no second parser and no sideways import of
  // `src/bus` data.
] as const satisfies readonly LayerSpec[];

export type BaseLayerId = (typeof BASE_LAYERS)[number]["id"];

/**
 * ONE route for every festival layer, whichever festival. The app keys its
 * overlay cache on this string, so six layers cost one fetch and one cache
 * entry, each rendering the subset carrying its own `layerId`. Named for the
 * mechanism rather than the event, so next year's config changes no URL.
 */
export const EVENT_OVERLAYS_ENDPOINT = "/map/overlays/event";

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
 * How a festival ZONE or route line is drawn, shared by every festival for the
 * same reason `EVENT_LAYER_STYLE` is: this is the map's business, not the
 * event's. Only `color` varies, and it is content.
 *
 * A translucent fill and a visible outline are not taste. The client's polygon
 * overlay defaults `color` to opaque black and `outlineWidth` to 0, so a zone
 * shipped without both would be a solid black blob with no border, hiding the
 * booths it is supposed to group.
 */
export const EVENT_SHAPE_STYLE = {
  fillOpacity: 0.18,
  outlineWidth: 2,
} as const satisfies MapLayerStyle;

/**
 * The live festival's layers as ordinary `LayerSpec`s.
 *
 * Every one is the user's to turn off, 편의시설 included — that one merely
 * starts hidden, per its `defaultVisibleWhen`. Nothing in a festival set is a
 * locked background layer. The chip group is the layer set id, so two festivals
 * could never share one, and a chip swaps these layers between themselves while
 * leaving 건물번호 and 건물이름 exactly as the user left them.
 *
 * Fresh objects per call. The config is frozen shallowly and shared across
 * every request, so nothing built from it may hand a config object through to
 * a response by reference.
 */
/**
 * A `LayerDefaultVisibility` copied to its leaves.
 *
 * `Object.freeze` on the config is shallow, so the `windows` array and each
 * window in it are the config's own mutable objects. Handing one to a response
 * would share it across every request — the rule stated above, which every
 * other field here and in `resetChip` already keeps.
 */
function copyVisibility(when: LayerDefaultVisibility): LayerDefaultVisibility {
  if (when.kind !== "scheduled") return { kind: when.kind };
  const [first, ...rest] = when.windows;
  return { kind: "scheduled", windows: [{ ...first }, ...rest.map((w) => ({ ...w }))] };
}

export function eventLayerSpecs(config: EventMapConfig): LayerSpec[] {
  return config.layers.map((layer) => ({
    id: layer.id,
    // Every festival layer keeps a marker style, because a layer that draws no
    // pins simply never uses it. That is cheaper than a config field saying
    // which layers have pins — a claim that could disagree with the places
    // actually stored, which is the second-discriminant problem again.
    markerStyle: "placeDot",
    label: layer.label,
    defaultVisibleWhen: copyVisibility(layer.defaultVisibleWhen),
    userConfigurable: true,
    endpoint: EVENT_OVERLAYS_ENDPOINT,
    chipGroupId: config.layerSetId,
    // `outlineColor` is the category colour at full strength while `color`
    // fills at EVENT_SHAPE_STYLE's opacity, so a zone reads as its category
    // without hiding the booths inside it. Derived rather than authored: a
    // second colour in the config would be a value that can only ever be
    // wrong, since a zone outlined in one category's colour and filled in
    // another's means nothing.
    style: {
      color: layer.color,
      outlineColor: layer.color,
      ...EVENT_LAYER_STYLE,
      ...EVENT_SHAPE_STYLE,
    },
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
