/**
 * publish() — the only writer of the snapshots collection (skkuverse#14).
 * Contract: docs/reference/eventmap-api.md §6.2, §6.3.
 *
 * Everything below is about NOT writing, or about writing exactly once. Three of
 * these four "no write" paths are what keep `immutable, max-age=1y` from
 * thrashing or a bad config from blanking a live map; the fourth is dryRun, the
 * only safety net ops have without an admin UI.
 *
 * The data layer is mocked wholesale — this file is the decision logic, and the
 * queries themselves are shaped by §5's indexes rather than by this module.
 */
import type { EventMapConfig } from "../../../src/eventmap/types";

jest.mock("../../../src/eventmap/eventmap.data", () => ({
  findActiveActivation: jest.fn(),
  findActivationById: jest.fn(),
  loadPlaces: jest.fn(),
  loadSessions: jest.fn(),
  findLatestSnapshot: jest.fn(),
  insertSnapshot: jest.fn(),
  expireSupersededVersions: jest.fn(),
  ensureIndexes: jest.fn(),
  findSnapshotByVersion: jest.fn(),
}));

const postToFcmFunction = jest.fn();
jest.mock("../../../src/common/fcm-client", () => ({
  postToFcmFunction: (...a: unknown[]) => postToFcmFunction(...a),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock("../../../src/infra/logger", () => mockLogger);

// Only getLayerSetConfig is faked; canonicalStringify/md5 stay real because the
// content hash they produce is the thing under test.
const actualConfigModule = jest.requireActual("../../../src/eventmap/eventmap.config");
const getLayerSetConfig = jest.fn();
jest.mock("../../../src/eventmap/eventmap.config", () => ({
  ...jest.requireActual("../../../src/eventmap/eventmap.config"),
  getLayerSetConfig: (...args: unknown[]) => getLayerSetConfig(...args),
}));

import { EventMapMaterializerService } from "../../../src/eventmap/eventmap-materializer.service";
import {
  expireSupersededVersions,
  findActivationById,
  findActiveActivation,
  findLatestSnapshot,
  insertSnapshot,
  loadPlaces,
  loadSessions,
} from "../../../src/eventmap/eventmap.data";
import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";

const REAL = actualConfigModule.getLayerSetConfig("eskara-2026") as {
  config: EventMapConfig;
  configHash: string;
  error: null;
};
const LOADED = { config: REAL.config, configHash: REAL.configHash, error: null };

const ACTIVATION = {
  _id: "eskara-2026",
  activeFrom: null,
  activeUntil: null,
  enabled: true,
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const PLACE = {
  _id: "nsc-bar-01",
  layerSetId: "eskara-2026",
  campus: "nsc" as const,
  name: { ko: "양일주점 1번" },
  location: { type: "Point" as const, coordinates: [126.971175, 37.294645] as [number, number] },
  zone: null,
  tags: [],
  lifecycle: "active" as const,
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const SESSION = {
  _id: "s1",
  layerSetId: "eskara-2026",
  placeId: "nsc-bar-01",
  campus: "nsc" as const,
  tenant: { id: "econ", name: { ko: "경제대" }, kind: "council" },
  title: { ko: "양일주점 1번" },
  subtitle: null,
  category: "bar",
  tags: [],
  dayIndex: 1,
  date: "2026-09-16",
  slot: "night",
  startAt: new Date("2026-09-16T09:00:00.000Z"),
  endAt: new Date("2026-09-16T17:00:00.000Z"),
  hoursLabel: null,
  media: { thumbnailUrl: null, images: [] },
  actions: [],
  order: 1,
  lifecycle: "published" as const,
  deletedAt: null,
  updatedAt: new Date("2026-09-10T00:00:00.000Z"),
};

const mocked = {
  findActiveActivation: findActiveActivation as jest.Mock,
  findActivationById: findActivationById as jest.Mock,
  loadPlaces: loadPlaces as jest.Mock,
  loadSessions: loadSessions as jest.Mock,
  findLatestSnapshot: findLatestSnapshot as jest.Mock,
  insertSnapshot: insertSnapshot as jest.Mock,
  expireSupersededVersions: expireSupersededVersions as jest.Mock,
};

function buildService(): EventMapMaterializerService {
  return new EventMapMaterializerService(new PollerRegistryService());
}

function duplicateKeyError(): Error {
  const err = new Error("E11000 duplicate key error") as Error & { code: number };
  err.code = 11000;
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  getLayerSetConfig.mockReturnValue(LOADED);
  mocked.findActiveActivation.mockResolvedValue(ACTIVATION);
  mocked.findActivationById.mockResolvedValue(ACTIVATION);
  mocked.loadPlaces.mockResolvedValue([PLACE]);
  mocked.loadSessions.mockResolvedValue([SESSION]);
  mocked.findLatestSnapshot.mockResolvedValue(null);
  mocked.insertSnapshot.mockResolvedValue(undefined);
  mocked.expireSupersededVersions.mockResolvedValue(undefined);
  postToFcmFunction.mockResolvedValue({ sent: 0, failed: 0 });
});

describe("publish — the paths that must NOT write", () => {
  it("does nothing when no layer set is active", async () => {
    mocked.findActiveActivation.mockResolvedValue(null);

    const summary = await buildService().publish({});

    expect(summary.reason).toBe("no-active-layer-set");
    expect(summary.published).toBe(false);
    expect(mocked.insertSnapshot).not.toHaveBeenCalled();
  });

  it("skips publication on an invalid config, leaving the previous snapshot live", async () => {
    // §6.2 step 3. A structure typo freezes the map at the last good version; it
    // must never blank a running festival.
    getLayerSetConfig.mockReturnValue({
      config: null,
      configHash: null,
      error: 'config.layers["bar"].iconId "nope" is not in config.icons',
    });

    const summary = await buildService().publish({});

    expect(summary.reason).toBe("invalid-config");
    expect(summary.error).toMatch(/iconId "nope"/);
    expect(mocked.insertSnapshot).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("reports unchanged when the content hash already matches the active snapshot", async () => {
    const first = await buildService().publish({});
    const publishedHash = first.contentHash;
    expect(first.published).toBe(true);

    mocked.insertSnapshot.mockClear();
    mocked.findLatestSnapshot.mockResolvedValue({
      version: 1,
      contentHash: publishedHash,
    });

    const second = await buildService().publish({});

    expect(second.reason).toBe("unchanged");
    expect(second.version).toBe(1);
    expect(mocked.insertSnapshot).not.toHaveBeenCalled();
  });

  it("does not mint a version across repeated passes with no data change", async () => {
    // #11 R4 end to end: `now` moves every tick, the hash does not.
    const a = await buildService().publish({});
    mocked.findLatestSnapshot.mockResolvedValue({
      version: 1,
      contentHash: a.contentHash,
    });
    const b = await buildService().publish({});
    const c = await buildService().publish({});

    expect(b.reason).toBe("unchanged");
    expect(c.reason).toBe("unchanged");
    expect(mocked.insertSnapshot).toHaveBeenCalledTimes(1);
  });

  it("materializes but writes nothing on dryRun", async () => {
    const summary = await buildService().publish({ dryRun: true });

    expect(summary.reason).toBe("dry-run");
    expect(summary.dryRun).toBe(true);
    expect(summary.counts).toEqual({ places: 1, sessions: 1, items: 1 });
    expect(summary.contentHash).toEqual(expect.any(String));
    expect(mocked.insertSnapshot).not.toHaveBeenCalled();
    expect(mocked.expireSupersededVersions).not.toHaveBeenCalled();
  });

  it("reports dropped sessions in the dryRun summary — the ops safety net", async () => {
    mocked.loadSessions.mockResolvedValue([
      SESSION,
      { ...SESSION, _id: "orphan", placeId: "nsc-missing" },
    ]);

    const summary = await buildService().publish({ dryRun: true });

    expect(summary.dropped).toEqual([
      { sessionId: "orphan", reason: 'unknown placeId "nsc-missing"' },
    ]);
    expect(summary.counts?.items).toBe(1);
  });
});

describe("publish — writing", () => {
  it("writes ONE document holding all three languages at version 1", async () => {
    const summary = await buildService().publish({});

    expect(summary.published).toBe(true);
    expect(summary.version).toBe(1);
    expect(summary.configVersion).toBe(REAL.config.configVersion);

    expect(mocked.insertSnapshot).toHaveBeenCalledTimes(1);
    const doc = mocked.insertSnapshot.mock.calls[0][0];
    expect(doc._id).toBe("eskara-2026:1");
    expect(Object.keys(doc.payloads).sort()).toEqual(["en", "ko", "zh"]);
    // gcAt null keeps the ACTIVE version out of the TTL monitor's reach.
    expect(doc.gcAt).toBeNull();
    // The payload's version is stamped after the hash comparison decided it.
    expect(doc.payloads.ko.version).toBe(1);
    expect(doc.payloads.zh.version).toBe(1);
  });

  it("gives every language a distinct ETag but the version one contentHash", async () => {
    await buildService().publish({});
    const doc = mocked.insertSnapshot.mock.calls[0][0];

    // ETag identifies the BYTES a URL serves, and ?lang= makes three URLs.
    expect(new Set(Object.values(doc.etags)).size).toBe(3);
    // contentHash identifies the INPUTS, which are language-independent — so it
    // is one field on the document rather than one per language.
    expect(typeof doc.contentHash).toBe("string");
  });

  it("increments from the current version and schedules the old one for GC", async () => {
    mocked.findLatestSnapshot.mockResolvedValue({ version: 16, contentHash: "stale" });

    const summary = await buildService().publish({});

    expect(summary.version).toBe(17);
    const [layerSetId, version, gcAt] = mocked.expireSupersededVersions.mock.calls[0];
    expect(layerSetId).toBe("eskara-2026");
    expect(version).toBe(17);
    expect(gcAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
  });

  it("targets a specific layer set WITHOUT requiring its window to be open", async () => {
    // The pre-flight path: validating next week's festival before it opens is the
    // whole value of dryRun, and impossible if the lookup demands a live window.
    await buildService().publish({ layerSetId: "eskara-2026" });

    expect(mocked.findActivationById).toHaveBeenCalledWith("eskara-2026");
    expect(mocked.findActiveActivation).not.toHaveBeenCalled();
  });

  it("reports an unknown targeted layer set distinctly from an idle one", async () => {
    mocked.findActivationById.mockResolvedValue(null);
    const summary = await buildService().publish({ layerSetId: "eskara-2099" });
    expect(summary.reason).toBe("unknown-layer-set");
  });
});

describe("publish — the concurrency design (§6.3)", () => {
  it("accepts a lost race when the winner published the same content", async () => {
    // Both replicas read the same inputs, so the winner's bytes are ours. Nothing
    // was lost and there is nothing left to do.
    let call = 0;
    mocked.findLatestSnapshot.mockImplementation(async () => {
      call += 1;
      if (call === 1) return null;
      return { version: 1, contentHash: pendingHash };
    });
    let pendingHash = "";
    mocked.insertSnapshot.mockImplementation(async (doc: { contentHash: string }) => {
      pendingHash = doc.contentHash;
      throw duplicateKeyError();
    });

    const summary = await buildService().publish({});

    expect(summary.reason).toBe("unchanged");
    expect(summary.version).toBe(1);
  });

  it("RETRIES at version + 1 when the winner published DIFFERENT content", async () => {
    // The gap in the usual "identical bytes, so the race is safe" argument: an
    // ops edit landing between the two reads makes the loser's materialization
    // the NEWER one. Exiting on 11000 here would silently discard a
    // festival-night correction.
    mocked.findLatestSnapshot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: 1, contentHash: "someone-elses-content" });
    mocked.insertSnapshot
      .mockRejectedValueOnce(duplicateKeyError())
      .mockResolvedValueOnce(undefined);

    const summary = await buildService().publish({});

    expect(summary.published).toBe(true);
    expect(summary.version).toBe(2);
    expect(mocked.insertSnapshot).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated conflicts rather than looping forever", async () => {
    mocked.findLatestSnapshot.mockResolvedValue({ version: 1, contentHash: "other" });
    mocked.insertSnapshot.mockRejectedValue(duplicateKeyError());

    const summary = await buildService().publish({});

    expect(summary.reason).toBe("conflict");
    expect(summary.published).toBe(false);
    expect(mocked.insertSnapshot).toHaveBeenCalledTimes(3);
  });

  it("rethrows a non-duplicate write error instead of swallowing it", async () => {
    mocked.insertSnapshot.mockRejectedValue(new Error("connection reset"));
    await expect(buildService().publish({})).rejects.toThrow("connection reset");
  });
});

describe("publish — force", () => {
  it("republishes identical inputs when force is set", async () => {
    // contentHash covers the INPUTS. It cannot see a deploy that changes the
    // materializer's output or a server-generated string on the wire, so without
    // this lever such a deploy would report `unchanged` forever and every client
    // would hold the pre-deploy payload for up to a year.
    const first = await buildService().publish({});
    mocked.insertSnapshot.mockClear();
    mocked.findLatestSnapshot.mockResolvedValue({
      version: 1,
      contentHash: first.contentHash,
    });

    const forced = await buildService().publish({ force: true });

    expect(forced.published).toBe(true);
    expect(forced.version).toBe(2);
    expect(mocked.insertSnapshot).toHaveBeenCalledTimes(1);
  });

  it("still reports unchanged without force", async () => {
    const first = await buildService().publish({});
    mocked.insertSnapshot.mockClear();
    mocked.findLatestSnapshot.mockResolvedValue({
      version: 1,
      contentHash: first.contentHash,
    });

    expect((await buildService().publish({})).reason).toBe("unchanged");
    expect(mocked.insertSnapshot).not.toHaveBeenCalled();
  });
});

describe("publish — GC self-heal", () => {
  it("re-stamps superseded versions on the unchanged path", async () => {
    // The repair for a pass whose insert landed but whose expire call then
    // failed: that pass exits through `unchanged` forever after, so without this
    // the superseded version keeps gcAt null and is never reaped.
    mocked.findLatestSnapshot.mockResolvedValue({ version: 4, contentHash: "x" });
    const service = buildService();
    const summary = await service.publish({});
    // Force a hash match by replaying the same materialization.
    mocked.findLatestSnapshot.mockResolvedValue({
      version: 5,
      contentHash: summary.contentHash,
    });
    mocked.expireSupersededVersions.mockClear();

    const again = await service.publish({});

    expect(again.reason).toBe("unchanged");
    expect(mocked.expireSupersededVersions).toHaveBeenCalledWith(
      "eskara-2026",
      5,
      expect.any(Date),
    );
  });
});

describe("publish — a conflict still reports what was materialized", () => {
  it("carries counts and contentHash through the give-up path", async () => {
    // Someone who hits three conflicts on a force-publish during an incident
    // still needs to know what WOULD have shipped.
    mocked.findLatestSnapshot.mockResolvedValue({ version: 1, contentHash: "other" });
    mocked.insertSnapshot.mockRejectedValue(duplicateKeyError());

    const summary = await buildService().publish({});

    expect(summary.reason).toBe("conflict");
    expect(summary.counts).toEqual({ places: 1, sessions: 1, items: 1 });
    expect(summary.contentHash).toEqual(expect.any(String));
  });
});

describe("publish — a bad ops date cannot freeze the map", () => {
  it("drops the session, keeps publishing, and names it in the summary", async () => {
    // The primary workflow is a festival-night `mongosh` edit, and quotes instead
    // of ISODate() round-trip as a STRING. Unguarded that is `.getTime()` on a
    // string — a throw out of the whole pass, so the poller would publish nothing
    // ever again AND dryRun, the tool for diagnosing it, would return the same
    // error instead of naming the row.
    mocked.loadSessions.mockResolvedValue([
      SESSION,
      { ...SESSION, _id: "typo", startAt: "2026-09-16T09:00:00Z" },
    ]);

    const summary = await buildService().publish({ dryRun: true });

    expect(summary.reason).toBe("dry-run");
    expect(summary.counts?.items).toBe(1);
    expect(summary.dropped).toEqual([
      { sessionId: "typo", reason: expect.stringContaining("must be dates or null") },
    ]);
  });
});

describe("publish — rejected buttons are surfaced", () => {
  it("reports and logs them rather than removing them silently", async () => {
    // A dropped BUTTON leaves the booth on the map, so the rendered result says
    // nothing went wrong. dryRun promises to report what would ship.
    mocked.loadSessions.mockResolvedValue([
      {
        ...SESSION,
        actions: [
          {
            id: "sponsor",
            label: { ko: "후원사" },
            actionType: "external",
            actionValue: "http://sponsor.example.com",
          },
        ],
      },
    ]);

    const summary = await buildService().publish({ dryRun: true });

    expect(summary.counts?.items).toBe(1);
    expect(summary.rejectedActions).toEqual([
      {
        sessionId: "s1",
        actionId: "sponsor",
        reason: expect.stringContaining("not valid for actionType"),
      },
    ]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rejectedActions: expect.any(Array) }),
      "[eventmap] Actions excluded from the snapshot",
    );
  });
});

describe("poller registration", () => {
  it("registers one poller at the configured interval", () => {
    const registry = new PollerRegistryService();
    const spy = jest.spyOn(registry, "registerPoller");

    new EventMapMaterializerService(registry).onModuleInit();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toBe("eventmap-materialize");
    expect(typeof spy.mock.calls[0][1]).toBe("number");
  });

  it("swallows and logs a failing pass so the registry's interval survives", async () => {
    const registry = new PollerRegistryService();
    const spy = jest.spyOn(registry, "registerPoller");
    mocked.findActiveActivation.mockRejectedValue(new Error("atlas is down"));

    new EventMapMaterializerService(registry).onModuleInit();
    const pollerFn = spy.mock.calls[0][0];

    await expect(pollerFn()).resolves.not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: "atlas is down" },
      "[eventmap] Materialize pass failed",
    );
  });
});

/**
 * The silent refresh push (skkuverse#17).
 *
 * Every case here is about NOT sending. A push that fires on the wrong branch is
 * worse than one that never fires: the poller runs every 60 seconds, so a push
 * on the "unchanged" path would wake every subscribed device once a minute,
 * forever, for a map that did not change.
 */
describe("publish — the silent refresh push", () => {
  const WIRED = { ...ACTIVATION, notifyMiniAppId: "eskara-2026" };

  it("fires once when a new version is written", async () => {
    mocked.findActiveActivation.mockResolvedValue(WIRED);

    await buildService().publish({});
    // The push is deliberately not awaited into the summary, so let the
    // microtask queue drain before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(postToFcmFunction).toHaveBeenCalledTimes(1);
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.type).toBe("eventmap-refresh");
    expect(payload.miniAppId).toBe("eskara-2026");
    expect(payload).not.toHaveProperty("notification");
  });

  it("does NOT fire on dryRun — nothing was written to refresh to", async () => {
    mocked.findActiveActivation.mockResolvedValue(WIRED);
    mocked.findActivationById.mockResolvedValue(WIRED);

    await buildService().publish({ layerSetId: "eskara-2026", dryRun: true });
    await Promise.resolve();

    expect(postToFcmFunction).not.toHaveBeenCalled();
  });

  it("does NOT fire on the unchanged branch — this is the 60s poller's path", async () => {
    mocked.findActiveActivation.mockResolvedValue(WIRED);
    // First pass publishes and establishes the content hash.
    await buildService().publish({});
    await Promise.resolve();
    await Promise.resolve();
    const hash = mocked.insertSnapshot.mock.calls[0][0].contentHash;
    postToFcmFunction.mockClear();

    // Second pass sees the same inputs.
    mocked.findLatestSnapshot.mockResolvedValue({ version: 1, contentHash: hash });
    const summary = await buildService().publish({});
    await Promise.resolve();
    await Promise.resolve();

    expect(summary.reason).toBe("unchanged");
    expect(postToFcmFunction).not.toHaveBeenCalled();
  });

  it("does NOT fire when no mini app is wired to the layer set", async () => {
    // ACTIVATION has no notifyMiniAppId. Absent means nobody is told, which is
    // the safe default — devices still converge on the ordinary poll.
    mocked.findActiveActivation.mockResolvedValue(ACTIVATION);

    await buildService().publish({});
    await Promise.resolve();
    await Promise.resolve();

    expect(postToFcmFunction).not.toHaveBeenCalled();
  });

  it("does NOT fire when the config is invalid — nothing was published", async () => {
    mocked.findActiveActivation.mockResolvedValue(WIRED);
    getLayerSetConfig.mockReturnValue({ config: null, configHash: null, error: "bad" });

    await buildService().publish({});
    await Promise.resolve();

    expect(postToFcmFunction).not.toHaveBeenCalled();
  });

  it("a failed push does not fail the publish", async () => {
    mocked.findActiveActivation.mockResolvedValue(WIRED);
    postToFcmFunction.mockRejectedValue(new Error("function down"));

    const summary = await buildService().publish({});
    await Promise.resolve();
    await Promise.resolve();

    expect(summary.published).toBe(true);
    expect(mocked.insertSnapshot).toHaveBeenCalled();
  });
});
