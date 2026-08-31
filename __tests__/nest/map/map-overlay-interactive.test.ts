/**
 * `interactive: false` — how a zone is drawn without becoming a tap target.
 *
 * Its own file because it needs a layer set the shipped `eskara-2026.json` does
 * not describe, so `activeEventConfig` is mocked wholesale rather than driven
 * through the real config loader as `map-event-overlays.test.ts` does.
 *
 * The behaviour matters because the alternative shapes were both worse. A
 * per-place flag would sit beside a populated `fields` array, giving the
 * meaningless combination "card rows nobody can open". Deriving it from "has no
 * fields or actions" would mean adding one card row silently turns a backdrop
 * into a button.
 */
jest.mock("../../../src/map/map-places.data", () => ({
  findActiveActivation: jest.fn(),
  getPlacesCollection: jest.fn(),
}));
jest.mock("../../../src/map/map-active-layerset", () => ({
  activeEventConfig: jest.fn(),
}));
jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { getPlacesCollection } from "../../../src/map/map-places.data";
import { activeEventConfig } from "../../../src/map/map-active-layerset";
import { getEventOverlays } from "../../../src/map/map-event-overlays.data";

const mockActiveEventConfig = activeEventConfig as jest.MockedFunction<
  typeof activeEventConfig
>;
const mockPlaces = getPlacesCollection as jest.MockedFunction<typeof getPlacesCollection>;

const RING: [number, number][] = [
  [126.9714, 37.2944],
  [126.9724, 37.2944],
  [126.9724, 37.2954],
  [126.9714, 37.2954],
  [126.9714, 37.2944],
];

/** Two categories on ONE layer: one tappable, one a backdrop. */
const CONFIG = {
  layerSetId: "test-set",
  itemDefaults: {
    byCategory: {
      zone: { layerId: "test_zones", pinPriority: 0, interactive: true },
      "zone-bg": { layerId: "test_zones", pinPriority: 0, interactive: false },
    },
    fallback: { layerId: "test_zones", pinPriority: 0, interactive: true },
  },
} as unknown as NonNullable<Awaited<ReturnType<typeof activeEventConfig>>>;

function place(id: string, category: string) {
  return {
    _id: id,
    layerSetId: "test-set",
    campus: "nsc",
    category,
    location: { type: "Polygon", coordinates: [RING] },
    title: { ko: "구역", en: "Zone" },
    subtitle: null,
    hours: [],
    fields: [{ label: { ko: "라벨" }, value: { ko: "값" } }],
    actions: [],
    order: 0,
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveEventConfig.mockResolvedValue(CONFIG);
  mockPlaces.mockReturnValue({
    find: jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([place("z-tappable", "zone"), place("z-backdrop", "zone-bg")]),
    }),
  } as never);
});

describe("interactive", () => {
  it("gives an interactive category the ordinary event tap", async () => {
    const { overlays } = await getEventOverlays();
    const tappable = overlays.find((o) => o.id === "z-tappable")!;

    expect(tappable.tap).toEqual({ kind: "event", placeId: "z-tappable" });
  });

  it("makes an inert category a backdrop with tap: null", async () => {
    const { overlays } = await getEventOverlays();
    const backdrop = overlays.find((o) => o.id === "z-backdrop")!;

    // `tap: null` is a spelling that already existed for a marker with nothing
    // to open, so background geometry needs no new field on the wire.
    expect(backdrop.tap).toBeNull();
  });

  it("still draws and still carries its card rows", async () => {
    const { overlays } = await getEventOverlays();
    const backdrop = overlays.find((o) => o.id === "z-backdrop")!;

    // Inert governs the TAP, not the drawing and not the content. A backdrop is
    // on the map and in the layer exactly like its neighbour.
    expect(backdrop.kind).toBe("polygon");
    expect(backdrop.layerId).toBe("test_zones");
    expect(backdrop.fields).toHaveLength(1);
  });

  it("lets one layer hold both, which is why the flag is per category", async () => {
    const { overlays } = await getEventOverlays();

    expect(overlays.map((o) => o.layerId)).toEqual(["test_zones", "test_zones"]);
    expect(overlays.map((o) => o.tap === null)).toEqual([false, true]);
  });
});
