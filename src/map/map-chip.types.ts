/**
 * The chip contract served inside `GET /map/config`.
 *
 * A chip is the control layers do not provide. A layer answers "what is drawn";
 * a chip answers "where should I be looking, and what should be on while I look
 * there". The server decides both; the app renders a pill and dispatches on
 * `action.kind` without interpreting it.
 *
 * ⚠️ NOT the same thing as `ChipSpec` / `ChipGroupSpec` / `WireChip` in
 * `src/eventmap/types.ts`. Those are predicate filters over snapshot ITEMS,
 * evaluated client-side against a tag vocabulary. A map chip carries an ACTION
 * and has no `Predicate` at all. The names are close because the UI affordance
 * is the same pill; the contracts are unrelated and must not be unified without
 * deciding that on purpose.
 *
 * This file exists because the event map's chip row was removed from the map
 * screen when booths became ordinary marker layers — chips filtered snapshot
 * items, and the pins stopped coming from a snapshot. That left the map with a
 * hardcoded mock chip row (`CampusChipRow.tsx`) waiting for exactly this.
 */

/**
 * How a camera moves, with no target.
 *
 * Split out from `MapCamera` because a chip and a marker-focus default want the
 * same four values and differ only in whether they carry their own coordinate:
 * a chip names where to go, `cameraDefaults.markerFocus` is applied to whatever
 * the user just tapped.
 *
 * ⚠️ The client cannot honour all four at once, and that is a limitation of the
 * map SDK rather than of this schema. `NaverMapViewRef.animateCameraTo` takes
 * `{latitude, longitude, zoom, duration, easing, pivot}` and NOT `tilt`/
 * `bearing`; the declarative `camera` prop carries `tilt`/`bearing` and has no
 * duration. So a camera with `tilt === 0 && bearing === 0` goes through
 * `animateCameraTo` and gets its `durationMs`, and any other camera goes
 * through the prop and animates at the SDK's own pace. The server sends the
 * whole thing regardless — picking the mechanism is the client's job, and
 * trimming the payload to match today's client would bake the limitation into
 * the wire.
 */
export interface CameraMotion {
  zoom: number;
  /** Degrees from vertical. 0 is straight down, which is the ordinary case. */
  tilt: number;
  /** Heading in degrees, 0 = north, clockwise. */
  bearing: number;
  durationMs: number;
}

/** A camera motion that names its own target. */
export interface MapCamera extends CameraMotion {
  lat: number;
  lng: number;
}

/**
 * Tagged so a second icon kind (a remote image, an SF Symbol) can arrive
 * without the emoji case having to grow a discriminating field of its own —
 * the shape `IconSpec` already uses next door in the event map.
 */
export type MapChipIcon = { kind: "emoji"; emoji: string };

/**
 * What a chip tap resolves to.
 *
 * Discriminated on `kind`, matching `MarkerTap` and `IconSpec` in this same
 * domain, rather than on the flat `actionType` + `actionValue: string` pair the
 * home screen's SDUI uses. That pair cannot carry a camera, and encoding one as
 * JSON inside a string would put a second parser on the wire.
 *
 * `webview` deliberately reuses the name and the validator of the SDUI action
 * type it corresponds to (`src/infra/webview-url.ts`), so there is one rule for
 * what counts as a usable web view URL and not two.
 *
 * The reserved third variant is the "markers near a position" chip. It is
 * written down rather than built so that adding it stays additive:
 *
 *   | { kind: "nearby"; origin: "device" | "camera"; radiusM: number;
 *       endpoint: string; layerIds: string[] }
 *
 * `origin` is on the wire rather than fixed here because one chip can
 * reasonably mean "near me" and another "near what I am looking at", and only
 * the server knows which. ⚠️ It will also need its own client-side query hook:
 * `useLayerMarkers` keys its cache on the endpoint STRING, so a URL carrying
 * `?lat=&lng=&radiusM=` mints a fresh cache entry per camera position.
 */
export type MapChipAction =
  | {
      kind: "webview";
      /**
       * Always absolute. A root-relative value is the preferred spelling in the
       * source and is resolved against `WEBVIEW_ORIGIN` before it ships, so a
       * relative string is never handed to a URL opener.
       *
       * No `title` beside it. The client already holds the chip's `label`, and
       * the header title of a page a chip opened is that label — a chip reading
       * 분실물 opens a page titled 분실물. A second string would be one more
       * thing to keep in step for no reachable difference.
       */
      url: string;
    }
  | {
      kind: "focus";
      camera: MapCamera;
      /**
       * The layers this chip switches ON, and — through their shared
       * `chipGroupId` — the set it switches OFF.
       *
       * Two rules govern what a tap may change, both stated on the layer side
       * in `map-layers.data.ts`:
       *
       *  1. Only layers sharing the `chipGroupId` of the layers named here are
       *     affected. Named → on, unnamed sibling → off, everything outside the
       *     group → untouched.
       *  2. A `userConfigurable: false` layer is never changed. A chip tap is a
       *     user-initiated change, and that flag already answers who may make
       *     one.
       *
       * An EMPTY array is the camera-only chip: no group is resolved, so no
       * visibility changes. That is why this is not nullable — `[]` already
       * says it, and a second spelling for the same state is a second thing to
       * get wrong.
       */
      layerIds: string[];
    };

export interface MapChip {
  id: string;
  /**
   * Resolved server-side from `map.chip.<id>`, the way layer labels are.
   *
   * Not shipped as `{ko, en, zh}` like `MapMarker.text`: that field ships every
   * language because its two producers hold different sets and resolving would
   * discard some. A chip label has one producer — this repo's i18n table — so
   * every language is always present and there is nothing to lose by picking.
   */
  label: string;
  /**
   * `null` is declared before it is reachable, on purpose. Every chip served
   * today carries an emoji, so nothing sends `null` yet — but widening a
   * non-nullable field LATER breaks every client already narrowed to the
   * non-null type, and a text-only chip is an ordinary thing to want. Declaring
   * it now costs one branch in the client and buys the ability to add one
   * without a coordinated release, which is the same reasoning behind "an
   * absent `userConfigurable` means true".
   */
  icon: MapChipIcon | null;
  action: MapChipAction;
}
