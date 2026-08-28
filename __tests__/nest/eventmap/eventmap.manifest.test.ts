/**
 * The manifest read path (skkuverse#14). Contract:
 * docs/reference/eventmap-api.md §7.1, §9, §12.
 *
 * The load-bearing behaviour here is nextChangeAt being DERIVED per request
 * rather than echoed from the snapshot. Everything else about the design pushes
 * toward staleness on purpose — the version does not move on an idle tick, the
 * payload is served immutable for a year — so this one field is what tells the
 * client when to re-render, and a stored value would be in the past within
 * minutes of publication.
 *
 * (Index creation on boot is covered by eventmap.service.test.ts, which mocks
 * lib/db directly; this file mocks the data layer instead.)
 */
jest.mock("../../../src/eventmap/eventmap.data", () => ({
  ensureIndexes: jest.fn(),
  findActiveActivation: jest.fn(),
  findLatestSnapshot: jest.fn(),
  findSnapshotByVersion: jest.fn(),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock("../../../src/infra/logger", () => mockLogger);

import {
  clearEventMapCaches,
  EventMapService,
  nextChangeAfter,
} from "../../../src/eventmap/eventmap.service";
import {
  findActiveActivation,
  findLatestSnapshot,
  findSnapshotByVersion,
} from "../../../src/eventmap/eventmap.data";
import type { EventMapItem } from "../../../src/eventmap/types";

const NOW_ISO = "2026-09-16T09:00:00.000Z";
const at = (minutesFromNow: number) =>
  new Date(Date.parse(NOW_ISO) + minutesFromNow * 60_000).toISOString();

function item(overrides: Partial<EventMapItem> = {}): EventMapItem {
  return {
    id: "s1",
    placeId: "nsc-bar-01",
    stackKey: "nsc-bar-01",
    lat: 37.294645,
    lng: 126.971175,
    title: "양일주점 1번",
    subtitle: null,
    tags: [],
    status: "open",
    startAt: at(-60),
    endAt: at(60),
    hoursLabel: null,
    layerId: "eskara26_bar",
    pinPriority: 30,
    cardTemplateId: "bar",
    order: 1,
    media: { thumbnailUrl: null, images: [] },
    fields: {},
    actions: [],
    ...overrides,
  };
}

const ACTIVATION = {
  _id: "eskara-2026",
  activeFrom: null,
  activeUntil: null,
  enabled: true,
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

function snapshot(items: EventMapItem[], version = 17) {
  const payload = { schemaVersion: 2, id: "eskara-2026", version, items };
  return {
    _id: `eskara-2026:${version}`,
    layerSetId: "eskara-2026",
    version,
    payloads: { ko: payload, en: payload, zh: payload },
    etags: { ko: '"ko-tag"', en: '"en-tag"', zh: '"zh-tag"' },
    contentHash: "abc",
    materializedAt: new Date("2026-09-15T23:40:00.000Z"),
    publishedAt: new Date("2026-09-15T23:40:11.000Z"),
    gcAt: null,
  };
}

const mocked = {
  findActiveActivation: findActiveActivation as jest.Mock,
  findLatestSnapshot: findLatestSnapshot as jest.Mock,
  findSnapshotByVersion: findSnapshotByVersion as jest.Mock,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearEventMapCaches();
});

describe("nextChangeAfter — derived, not echoed", () => {
  const now = new Date(NOW_ISO);

  it("picks the earliest boundary strictly ahead of now", () => {
    const items = [
      item({ startAt: at(-60), endAt: at(30) }),
      item({ startAt: at(5), endAt: at(90) }),
      item({ startAt: at(-90), endAt: at(-10) }),
    ];
    expect(nextChangeAfter(items, now)).toBe(at(5));
  });

  it("advances as boundaries pass, WITHOUT the snapshot changing", () => {
    // The whole point of D2: the same immutable payload yields a different
    // answer as the clock moves. An echoed value would be frozen at publication.
    const items = [item({ startAt: at(5), endAt: at(20) })];
    expect(nextChangeAfter(items, now)).toBe(at(5));
    expect(nextChangeAfter(items, new Date(Date.parse(at(10))))).toBe(at(20));
    expect(nextChangeAfter(items, new Date(Date.parse(at(30))))).toBeNull();
  });

  it("ignores items with a missing bound — their status never changes", () => {
    // Cancelled items ship null bounds, and a one-sided window is permanently
    // `unknown`. Waking every device for a non-event is worse than not waking it.
    const items = [
      item({ startAt: null, endAt: null }),
      item({ startAt: at(2), endAt: null }),
      item({ startAt: at(-5), endAt: at(45) }),
    ];
    expect(nextChangeAfter(items, now)).toBe(at(45));
  });

  it("returns null for an empty snapshot", () => {
    expect(nextChangeAfter([], now)).toBeNull();
  });

  it("ignores an unparseable instant rather than throwing", () => {
    const items = [item({ startAt: "not-a-date", endAt: at(15) })];
    expect(nextChangeAfter(items, now)).toBe(at(15));
  });
});

describe("getManifest", () => {
  it("reports the active layer set with a server-formed, lang-scoped snapshotUrl", async () => {
    mocked.findActiveActivation.mockResolvedValue(ACTIVATION);
    mocked.findLatestSnapshot.mockResolvedValue(snapshot([item()]));

    const { manifest, degraded } = await new EventMapService().getManifest("en");

    expect(degraded).toBe(false);
    expect(manifest.activeLayerSetId).toBe("eskara-2026");
    expect(manifest.version).toBe(17);
    expect(manifest.snapshotUrl).toBe("/eventmap/snapshot/eskara-2026/17?lang=en");
    expect(manifest.refreshAfterSec).toBe(60);
    expect(manifest.publishedAt).toBe("2026-09-15T23:40:11.000Z");
  });

  it("reads one document regardless of requested language", async () => {
    // Version, publishedAt and boundaries are language-independent; only
    // snapshotUrl's ?lang= differs. So the memo is one entry, not three, and the
    // lookup carries no lang at all.
    mocked.findActiveActivation.mockResolvedValue(ACTIVATION);
    mocked.findLatestSnapshot.mockResolvedValue(snapshot([item()]));

    await new EventMapService().getManifest("zh");

    expect(mocked.findLatestSnapshot).toHaveBeenCalledWith("eskara-2026");
  });

  it("reports inactive when the kill switch is flipped", async () => {
    mocked.findActiveActivation.mockResolvedValue(null);

    const { manifest, degraded } = await new EventMapService().getManifest("ko");

    expect(degraded).toBe(false);
    expect(manifest.activeLayerSetId).toBeNull();
    expect(manifest.version).toBeNull();
    expect(manifest.snapshotUrl).toBeNull();
    expect(manifest.refreshAfterSec).toBe(300);
  });

  it("reports inactive when an activation exists but nothing is published yet", async () => {
    // Advertising a layer set with no snapshotUrl to follow is worse than
    // silence — it reads as inactive until the materializer's first pass lands.
    mocked.findActiveActivation.mockResolvedValue(ACTIVATION);
    mocked.findLatestSnapshot.mockResolvedValue(null);

    const { manifest } = await new EventMapService().getManifest("ko");

    expect(manifest.activeLayerSetId).toBeNull();
  });

  it("NEVER throws — a DB error degrades to inactive and is flagged", async () => {
    mocked.findActiveActivation.mockRejectedValue(new Error("atlas is down"));

    const { manifest, degraded } = await new EventMapService().getManifest("ko");

    expect(degraded).toBe(true);
    expect(manifest.activeLayerSetId).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("memoizes the DB read but re-derives nextChangeAt per call", async () => {
    mocked.findActiveActivation.mockResolvedValue(ACTIVATION);
    mocked.findLatestSnapshot.mockResolvedValue(snapshot([item()]));
    const service = new EventMapService();

    const first = await service.getManifest("ko");
    const second = await service.getManifest("ko");

    expect(mocked.findActiveActivation).toHaveBeenCalledTimes(1);
    expect(first.manifest.nextChangeAt).toBe(second.manifest.nextChangeAt);
  });

  it("re-reads after clearEventMapCaches — the publish-time invalidation", async () => {
    mocked.findActiveActivation.mockResolvedValue(ACTIVATION);
    mocked.findLatestSnapshot.mockResolvedValue(snapshot([item()]));
    const service = new EventMapService();

    await service.getManifest("ko");
    clearEventMapCaches();
    await service.getManifest("ko");

    // Note this is PROCESS-LOCAL. When the poller publishes, the api replicas
    // keep their own memos until the 15 s TTL expires — which is where §12's
    // staleness budget comes from.
    expect(mocked.findActiveActivation).toHaveBeenCalledTimes(2);
  });
});

describe("getSnapshot", () => {
  it("serves from the DB on a miss and from the memo afterwards", async () => {
    mocked.findSnapshotByVersion.mockResolvedValue(snapshot([item()]));
    const service = new EventMapService();

    await service.getSnapshot("eskara-2026", 17);
    await service.getSnapshot("eskara-2026", 17);

    // A festival crowd's cold fetches must not each become a 30 KB Mongo read.
    expect(mocked.findSnapshotByVersion).toHaveBeenCalledTimes(1);
  });

  it("keys the memo by version, so an entry can never be stale", async () => {
    mocked.findSnapshotByVersion.mockImplementation(
      async (_id: string, version: number) => snapshot([item()], version),
    );
    const service = new EventMapService();

    const seventeen = await service.getSnapshot("eskara-2026", 17);
    const eighteen = await service.getSnapshot("eskara-2026", 18);

    expect(seventeen?.version).toBe(17);
    expect(eighteen?.version).toBe(18);
  });

  it("does not cache a miss", async () => {
    mocked.findSnapshotByVersion.mockResolvedValue(null);
    const service = new EventMapService();

    await service.getSnapshot("eskara-2026", 999);
    await service.getSnapshot("eskara-2026", 999);

    // A version reaped by TTL is a 404 the client recovers from by refetching the
    // manifest; caching the absence would only delay that recovery.
    expect(mocked.findSnapshotByVersion).toHaveBeenCalledTimes(2);
  });
});
