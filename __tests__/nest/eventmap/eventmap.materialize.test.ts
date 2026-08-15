/**
 * The pure materializer (skkuverse#14). Contract:
 * docs/reference/eventmap-api.md §6.
 *
 * No DB and no clock, so everything here is fixtures in / object out. That is
 * the point of the module's shape: this is where the repo's 75 % line-coverage
 * gate gets paid, the role weightedRandomSelect plays for src/ad.
 *
 * The tests worth having are the ones whose failures are SILENT in production:
 * a swapped coordinate puts a booth in the Yellow Sea without an error, a
 * cancelled booth that re-derives itself back to "open" sends people walking, and
 * a content hash that ignores a Mongo edit means a festival-night fix never ships.
 */
import { WEBVIEW_ORIGIN } from "../../../src/infra/origins";
import { getLayerSetConfig } from "../../../src/eventmap/eventmap.config";
import {
  buildTags,
  computeContentHash,
  deriveStatus,
  materialize,
  type MaterializeInput,
} from "../../../src/eventmap/eventmap.materialize";
import type {
  ActivationDoc,
  EventMapConfig,
  PlaceDoc,
  SessionDoc,
} from "../../../src/eventmap/types";

const NOW = new Date("2026-09-16T09:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

/**
 * The REAL shipped config, not a fixture. Loading it here means every test in
 * this file also asserts that src/eventmap/config/eskara-2026.json passes
 * validation — a structural typo cannot reach a deploy while these run.
 */
const loaded = getLayerSetConfig("eskara-2026");
if (!loaded || loaded.error !== null) {
  throw new Error(`eskara-2026 config failed to load: ${loaded?.error ?? "missing"}`);
}
const CONFIG: EventMapConfig = loaded.config;
const CONFIG_HASH = loaded.configHash;

const ACTIVATION: ActivationDoc = {
  _id: "eskara-2026",
  activeFrom: new Date("2026-09-15T00:00:00.000Z"),
  activeUntil: new Date("2026-09-18T00:00:00.000Z"),
  enabled: true,
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

function place(overrides: Partial<PlaceDoc> = {}): PlaceDoc {
  return {
    _id: "nsc-bar-01",
    layerSetId: "eskara-2026",
    campus: "nsc",
    name: { ko: "양일주점 1번" },
    // GeoJSON is [lng, lat] — 126 first, 37 second.
    location: { type: "Point", coordinates: [126.971175, 37.294645] },
    zone: "대운동장 동편",
    tags: [],
    lifecycle: "active",
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function session(overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    _id: "eskara-2026-d1-bar-01",
    layerSetId: "eskara-2026",
    placeId: "nsc-bar-01",
    campus: "nsc",
    tenant: { id: "econ-council", name: { ko: "경제대학 학생회" }, kind: "council" },
    title: { ko: "양일주점 1번", en: "Bar 1" },
    subtitle: null,
    category: "bar",
    tags: [],
    dayIndex: 1,
    date: "2026-09-16",
    slot: "night",
    startAt: minutes(-60),
    endAt: minutes(60),
    hoursLabel: { ko: "18:00–02:00" },
    media: { thumbnailUrl: null, images: [] },
    actions: [],
    order: 1,
    lifecycle: "published",
    deletedAt: null,
    updatedAt: new Date("2026-09-10T00:00:00.000Z"),
    ...overrides,
  };
}

function input(overrides: Partial<MaterializeInput> = {}): MaterializeInput {
  return {
    config: CONFIG,
    configHash: CONFIG_HASH,
    activation: ACTIVATION,
    places: [place()],
    sessions: [session()],
    now: NOW,
    ...overrides,
  };
}

describe("deriveStatus — §6.2's table, at every boundary", () => {
  it("treats both bounds null as always-on open", () => {
    expect(deriveStatus(session({ startAt: null, endAt: null }), NOW)).toBe("open");
  });

  it("returns upcoming strictly before startAt", () => {
    expect(deriveStatus(session({ startAt: minutes(1), endAt: minutes(60) }), NOW)).toBe(
      "upcoming",
    );
  });

  it("opens exactly AT startAt — the boundary is inclusive", () => {
    expect(deriveStatus(session({ startAt: NOW, endAt: minutes(60) }), NOW)).toBe("open");
  });

  it("closes exactly AT endAt — the boundary is exclusive", () => {
    expect(deriveStatus(session({ startAt: minutes(-60), endAt: NOW }), NOW)).toBe(
      "closed",
    );
  });

  it("returns unknown when only one bound is set", () => {
    expect(deriveStatus(session({ startAt: minutes(-10), endAt: null }), NOW)).toBe(
      "unknown",
    );
    expect(deriveStatus(session({ startAt: null, endAt: minutes(10) }), NOW)).toBe(
      "unknown",
    );
  });

  it("closes a cancelled session even when its window spans now", () => {
    expect(deriveStatus(session({ lifecycle: "cancelled" }), NOW)).toBe("closed");
  });

  it("closes a cancelled always-on facility too — lifecycle beats data shape", () => {
    const cancelled = session({
      lifecycle: "cancelled",
      startAt: null,
      endAt: null,
    });
    expect(deriveStatus(cancelled, NOW)).toBe("closed");
  });

  it("survives a session that crosses midnight into the next civil date", () => {
    // A 22:00–02:00 KST 주점 belongs to festival day 1 but ends on day 2's CIVIL
    // date, which is why `date` is stored rather than derived. Absolute instants
    // are what make status a non-event here; "18:00" strings would not be.
    const crossing = session({
      date: "2026-09-16",
      startAt: new Date("2026-09-16T13:00:00.000Z"), // 22:00 KST, day 1
      endAt: new Date("2026-09-16T17:00:00.000Z"), // 02:00 KST, day 2
    });
    const seoulDate = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);

    expect(seoulDate(crossing.startAt!)).toBe(crossing.date);
    expect(seoulDate(crossing.endAt!)).toBe("2026-09-17");
    expect(deriveStatus(crossing, new Date("2026-09-16T15:00:00.000Z"))).toBe("open");
    expect(deriveStatus(crossing, new Date("2026-09-16T17:00:00.000Z"))).toBe("closed");
  });
});

describe("materialize — items", () => {
  it("converts GeoJSON [lng, lat] to named scalars", () => {
    const result = materialize(input());
    const item = result.payloads.ko.items[0]!;

    expect(item.lat).toBe(37.294645);
    expect(item.lng).toBe(126.971175);
    // The equality above passes a mirrored implementation too. These ranges are
    // what turn red if the single conversion site is ever "simplified": SKKU is
    // 37.xN 126.xE, and a swap raises no error anywhere downstream.
    expect(item.lat).toBeGreaterThan(37);
    expect(item.lat).toBeLessThan(38);
    expect(item.lng).toBeGreaterThan(126);
    expect(item.lng).toBeLessThan(127);
  });

  it("ships startAt/endAt so the client can re-derive status on its own clock", () => {
    const item = materialize(input()).payloads.ko.items[0]!;
    expect(item.startAt).toBe(minutes(-60).toISOString());
    expect(item.endAt).toBe(minutes(60).toISOString());
    expect(item.status).toBe("open");
  });

  it("ships a cancelled session as closed, present, and WITHOUT bounds", () => {
    const result = materialize(
      input({ sessions: [session({ lifecycle: "cancelled" })] }),
    );
    const item = result.payloads.ko.items[0]!;

    // Present, not hidden: people walk to a booth that is silently absent.
    expect(result.payloads.ko.items).toHaveLength(1);
    expect(item.status).toBe("closed");
    expect(item.fields.cancelled).toBe("운영 취소");
    // Null bounds are load-bearing. The client's rule is "both null → trust the
    // shipped status, else recompute", so shipping the real window would make a
    // rain-cancelled 주점 flip itself back to 운영중 on every phone at 18:00.
    expect(item.startAt).toBeNull();
    expect(item.endAt).toBeNull();
    // The hours are not lost — they survive as display text, which is never re-derived.
    expect(item.hoursLabel).toBe("18:00–02:00");
  });

  it("ships a ONE-SIDED session without bounds, like a cancelled one", () => {
    // One rule: bounds ship iff the status can change. A one-sided window is
    // permanently `unknown`, so shipping its single bound would send the client
    // into deriveStatus(startAt, null, now) — behaviour neither side specifies —
    // and it would then disagree with the ["status",["open"]] chip filtering it.
    // No boundary is contributed either, so no republish ever corrects the drift.
    const oneSided = session({ startAt: minutes(-10), endAt: null });
    const item = materialize(input({ sessions: [oneSided] })).payloads.ko.items[0]!;

    expect(item.status).toBe("unknown");
    expect(item.startAt).toBeNull();
    expect(item.endAt).toBeNull();
  });

  it("drops a session whose bounds are strings rather than dates", () => {
    // A `mongosh` $set with quotes instead of ISODate() stores a STRING. Left
    // unchecked that is .getTime() on a string — a throw out of the entire pass,
    // freezing the map at its last version and breaking the dryRun meant to
    // diagnose it.
    const typo = session({ _id: "typo" });
    (typo as unknown as { startAt: unknown }).startAt = "2026-09-16T09:00:00Z";

    const result = materialize(input({ sessions: [typo, session()] }));

    expect(result.payloads.ko.items).toHaveLength(1);
    expect(result.dropped[0]!.sessionId).toBe("typo");
    expect(result.dropped[0]!.reason).toContain("must be dates or null");
  });

  it("keeps deriveStatus total against a non-date bound", () => {
    const typo = session();
    (typo as unknown as { endAt: unknown }).endAt = "nope";
    // NaN comparisons are all false, so an unguarded version would silently
    // report `closed` — a booth that is open telling everyone it is shut.
    expect(deriveStatus(typo, NOW)).toBe("unknown");
  });

  it("excludes draft and hidden sessions entirely", () => {
    // The materializer is only ever handed published/cancelled by the data layer;
    // this pins the wire-visible half of that contract.
    const result = materialize(
      input({
        sessions: [
          session({ _id: "published-one" }),
          session({ _id: "cancelled-one", lifecycle: "cancelled" }),
        ],
      }),
    );
    const ids = result.payloads.ko.items.map((i) => i.id);
    expect(ids).toEqual(["published-one", "cancelled-one"]);
  });

  it("derives stackKey from placeId, or zone when the config says so", () => {
    expect(materialize(input()).payloads.ko.items[0]!.stackKey).toBe("nsc-bar-01");

    const byZone = materialize(
      input({ config: { ...CONFIG, stackKeyBy: "zone" } }),
    );
    expect(byZone.payloads.ko.items[0]!.stackKey).toBe("대운동장 동편");
  });

  it("falls back to the generic presentation for an unmapped category", () => {
    // `category` is an OPEN string edited in Mongo, so this is CONTENT, not a
    // config bug — it must degrade rather than block publication.
    const result = materialize(input({ sessions: [session({ category: "전시" })] }));
    const item = result.payloads.ko.items[0]!;
    expect(item.iconId).toBe(CONFIG.itemDefaults.fallback.iconId);
    expect(item.cardTemplateId).toBe(CONFIG.itemDefaults.fallback.cardTemplateId);
    expect(result.dropped).toEqual([]);
  });

  it("drops a session whose placeId does not resolve, and keeps the rest", () => {
    const result = materialize(
      input({
        sessions: [session({ _id: "orphan", placeId: "nsc-does-not-exist" }), session()],
      }),
    );
    expect(result.payloads.ko.items).toHaveLength(1);
    expect(result.dropped).toEqual([
      { sessionId: "orphan", reason: 'unknown placeId "nsc-does-not-exist"' },
    ]);
  });
});

describe("materialize — i18n", () => {
  it("resolves per language with en then ko fallback", () => {
    const result = materialize(input());
    expect(result.payloads.ko.items[0]!.title).toBe("양일주점 1번");
    expect(result.payloads.en.items[0]!.title).toBe("Bar 1");
    // zh is absent, so it falls through en → the contract's documented order.
    expect(result.payloads.zh.items[0]!.title).toBe("Bar 1");
  });

  it("treats a blank string as absent rather than rendering an empty label", () => {
    // `??` alone would accept ops' `en: ""` as present and ship a nameless pin,
    // which reads as a rendering bug and therefore survives a long time.
    const blank = session({ title: { ko: "양일주점 1번", en: "   " } });
    const result = materialize(input({ sessions: [blank] }));
    expect(result.payloads.en.items[0]!.title).toBe("양일주점 1번");
  });

  it("falls back to the tenant name for a missing subtitle", () => {
    expect(materialize(input()).payloads.ko.items[0]!.subtitle).toBe("경제대학 학생회");
  });

  it("drops a session with no usable title in any language", () => {
    const result = materialize(input({ sessions: [session({ title: { ko: "  " } })] }));
    expect(result.payloads.ko.items).toHaveLength(0);
    expect(result.dropped[0]!.reason).toBe("title is blank in every language");
  });

  it("KEEPS a session titled only in zh", () => {
    // The drop test has to look at every language. `pick(title, "ko")` tries
    // [ko, en, ko] and cannot see zh, so using it would discard this session
    // while logging "blank in every language" — a false statement that sends the
    // ops person looking in the wrong place.
    const zhOnly = session({ title: { ko: "", en: "", zh: "소융대 부스" } });
    const result = materialize(input({ sessions: [zhOnly] }));

    expect(result.dropped).toEqual([]);
    expect(result.payloads.zh.items[0]!.title).toBe("소융대 부스");
  });
});

describe("materialize — actions", () => {
  it("keeps well-formed actions and drops malformed ones without losing the booth", () => {
    const withActions = session({
      actions: [
        {
          id: "entry",
          label: { ko: "입장 안내" },
          actionType: "webview",
          actionValue: "/eskara/entry",
          style: "primary",
        },
        // Relative value handed to a URL opener — the shape of an open redirect.
        {
          id: "bad",
          label: { ko: "잘못된 링크" },
          actionType: "external",
          actionValue: "/eskara/sponsor",
        },
        // `route` is NOT a URL: it reaches router.push, never an opener.
        {
          id: "shuttle",
          label: { ko: "셔틀 시간표" },
          actionType: "route",
          actionValue: "/(tabs)/transit",
        },
      ],
    });
    const result = materialize(input({ sessions: [withActions] }));
    const item = result.payloads.ko.items[0]!;
    expect(item.actions.map((a) => a.id)).toEqual(["entry", "shuttle"]);
    expect(item.actions[0]!.style).toBe("primary");

    // A silently removed button is invisible in the rendered result, so it has
    // to be reported — this is what dryRun shows ops.
    expect(result.rejectedActions).toEqual([
      { sessionId: expect.any(String), actionId: "bad", reason: expect.any(String) },
    ]);
  });

  it("rejects values that only LOOK anchored", () => {
    const sneaky = session({
      actions: [
        // `$` without the `m` flag matches before a final newline, so a
        // spreadsheet paste slips past an otherwise correct ^...$ pattern.
        { id: "trailing-newline", label: { ko: "a" }, actionType: "external", actionValue: "https://evil.com\n" },
        // A protocol-relative URL wearing a path's clothes.
        { id: "protocol-relative", label: { ko: "b" }, actionType: "route", actionValue: "//evil.com" },
        // The same escape with a backslash, which an anchored ^\/(?!\/) misses.
        // WHATWG folds "\" into "/" for special schemes, so this resolves to
        // https://evil.com/ the moment anything treats it as a relative URL.
        { id: "backslash-relative", label: { ko: "d" }, actionType: "route", actionValue: "/\\evil.com" },
        { id: "backslash-webview", label: { ko: "e" }, actionType: "webview", actionValue: "/\\evil.com" },
        { id: "http", label: { ko: "c" }, actionType: "webview", actionValue: "http://plain.example.com" },
      ],
    });
    const result = materialize(input({ sessions: [sneaky] }));

    expect(result.payloads.ko.items[0]!.actions).toEqual([]);
    expect(result.rejectedActions.map((r) => r.actionId).sort()).toEqual([
      "backslash-relative",
      "backslash-webview",
      "http",
      "protocol-relative",
      "trailing-newline",
    ]);
  });

  describe("webview values resolve against WEBVIEW_ORIGIN", () => {
    const webviewAction = (actionValue: string) =>
      session({ actions: [{ id: "entry", label: { ko: "입장 안내" }, actionType: "webview", actionValue }] });
    const actionsFor = (actionValue: string) =>
      materialize(input({ sessions: [webviewAction(actionValue)] })).payloads.ko.items[0]!.actions;

    it("joins a root-relative path onto the origin, so the wire carries a complete URL", () => {
      expect(actionsFor("/eskara/entry")[0]!.actionValue).toBe(`${WEBVIEW_ORIGIN}/eskara/entry`);
    });

    it("passes an absolute URL on our own origin through untouched", () => {
      const absolute = `${WEBVIEW_ORIGIN}/eskara/timetable`;
      expect(actionsFor(absolute)[0]!.actionValue).toBe(absolute);
    });

    it("rejects a fragment URL, which resolves to the shell root at HTTP 200", () => {
      // The whole reason this rule exists: it satisfies a prefix check, the app
      // sees no error because the status is 200, and the user gets the wrong page.
      expect(actionsFor(`${WEBVIEW_ORIGIN}/#/eskara/entry`)).toEqual([]);
    });

    it("rejects the shell root itself, in either spelling", () => {
      expect(actionsFor(`${WEBVIEW_ORIGIN}/`)).toEqual([]);
      expect(actionsFor("/")).toEqual([]);
    });

    it("rejects a webview URL on any other host, including the legacy one", () => {
      expect(actionsFor("https://webview.skkuuniverse.com/eskara/entry")).toEqual([]);
      expect(actionsFor("https://evil.example.com/eskara/entry")).toEqual([]);
    });

    it("leaves `external` alone — leaving the app is the point, so any https host is fine", () => {
      const sponsor = session({
        actions: [
          { id: "sponsor", label: { ko: "후원사" }, actionType: "external", actionValue: "https://www.skku.edu/" },
        ],
      });
      const actions = materialize(input({ sessions: [sponsor] })).payloads.ko.items[0]!.actions;
      expect(actions[0]!.actionValue).toBe("https://www.skku.edu/");
    });
  });

  it("reports action rejects ONCE, not once per language", () => {
    const bad = session({
      actions: [
        { id: "bad", label: { ko: "x" }, actionType: "external", actionValue: "nope" },
      ],
    });
    expect(materialize(input({ sessions: [bad] })).rejectedActions).toHaveLength(1);
  });

  it("keeps `content` actions, which are prose and may contain spaces", () => {
    const withContent = session({
      actions: [
        {
          id: "notice",
          label: { ko: "안내" },
          actionType: "content",
          actionValue: "우천 시 실내로 이동합니다.\n문의: 학생회",
        },
      ],
    });
    const item = materialize(input({ sessions: [withContent] })).payloads.ko.items[0]!;
    expect(item.actions.map((a) => a.id)).toEqual(["notice"]);
  });
});

describe("materialize — tags", () => {
  it("builds the §6.4 axes, lowercased and deduplicated", () => {
    const tags = buildTags(session({ tags: ["Featured", "featured"] }), place());
    expect(tags).toEqual([
      "cat:bar",
      "day:1",
      "slot:night",
      "tenant:econ-council",
      "kind:council",
      "place:nsc-bar-01",
      "zone:대운동장 동편",
      "featured",
    ]);
  });

  it("never emits status as a tag — the client recomputes it", () => {
    const tags = buildTags(session(), place());
    expect(tags.some((t) => t.startsWith("status:"))).toBe(false);
  });
});

describe("materialize — nextChangeAt", () => {
  it("is the minimum boundary strictly in the future", () => {
    const result = materialize(
      input({
        sessions: [
          session({ _id: "a", startAt: minutes(-60), endAt: minutes(30) }),
          session({ _id: "b", startAt: minutes(5), endAt: minutes(90) }),
          session({ _id: "c", startAt: minutes(-90), endAt: minutes(-10) }),
        ],
      }),
    );
    expect(result.nextChangeAt?.toISOString()).toBe(minutes(5).toISOString());
  });

  it("is null when every boundary is behind us", () => {
    const result = materialize(
      input({ sessions: [session({ startAt: minutes(-90), endAt: minutes(-10) })] }),
    );
    expect(result.nextChangeAt).toBeNull();
  });

  it("ignores cancelled and one-sided sessions — their status never changes", () => {
    const result = materialize(
      input({
        sessions: [
          session({ _id: "cancelled", lifecycle: "cancelled", startAt: minutes(2) }),
          session({ _id: "one-sided", startAt: minutes(3), endAt: null }),
          session({ _id: "real", startAt: minutes(-5), endAt: minutes(20) }),
        ],
      }),
    );
    expect(result.nextChangeAt?.toISOString()).toBe(minutes(20).toISOString());
  });
});

describe("computeContentHash — what must and must not move the version", () => {
  it("is identical across two different `now` values (#11 R4)", () => {
    // The whole caching design rests on this. If `now` leaked into the hash, a
    // 60 s poller would mint a version every tick and `immutable, max-age=1y`
    // would thrash forever.
    const a = computeContentHash(input({ now: NOW }));
    const b = computeContentHash(input({ now: minutes(45) }));
    expect(a).toBe(b);
  });

  it("changes when a field changes but updatedAt does NOT", () => {
    // The reason the hash covers whole documents rather than [_id, updatedAt]:
    // the feature exists so ops can `$set` a correction at 22:00, and a `$set`
    // that forgets updatedAt would otherwise be reported "unchanged" forever.
    const before = computeContentHash(input());
    const edited = session({ title: { ko: "양일주점 1번 (메뉴 변경)", en: "Bar 1" } });
    expect(edited.updatedAt).toEqual(session().updatedAt);
    expect(computeContentHash(input({ sessions: [edited] }))).not.toBe(before);
  });

  it("changes when the activation window moves", () => {
    const before = computeContentHash(input());
    const rescheduled: ActivationDoc = {
      ...ACTIVATION,
      activeUntil: new Date("2026-09-19T00:00:00.000Z"),
    };
    expect(computeContentHash(input({ activation: rescheduled }))).not.toBe(before);
  });

  it("is stable under document ORDER — two replicas must agree", () => {
    const a = computeContentHash(
      input({ sessions: [session({ _id: "a" }), session({ _id: "b" })] }),
    );
    const b = computeContentHash(
      input({ sessions: [session({ _id: "b" }), session({ _id: "a" })] }),
    );
    expect(a).toBe(b);
  });

  it("changes when the structure config changes", () => {
    const before = computeContentHash(input());
    expect(computeContentHash(input({ configHash: "different" }))).not.toBe(before);
  });
});

describe("materialize — payload shape", () => {
  it("emits one payload per language, all carrying the same structure", () => {
    const result = materialize(input());
    expect(Object.keys(result.payloads).sort()).toEqual(["en", "ko", "zh"]);
    for (const lang of ["ko", "en", "zh"] as const) {
      const payload = result.payloads[lang];
      expect(payload.lang).toBe(lang);
      expect(payload.id).toBe("eskara-2026");
      expect(payload.campus).toBe("nsc");
      expect(payload.layers.length).toBe(CONFIG.layers.length);
      expect(payload.chipGroups.length).toBe(CONFIG.chipGroups.length);
      expect(payload.sorts.length).toBe(CONFIG.sorts.length);
      expect(payload.cardTemplates.length).toBe(CONFIG.cardTemplates.length);
    }
  });

  it("resolves structure labels per language while keeping predicates verbatim", () => {
    const result = materialize(input());
    const koBar = result.payloads.ko.layers.find((l) => l.id === "bar")!;
    const enBar = result.payloads.en.layers.find((l) => l.id === "bar")!;
    expect(koBar.label).toBe("주점");
    expect(enBar.label).toBe("Bars");
    // Predicates are data the client evaluates, never text — they must not be
    // touched by i18n resolution.
    expect(enBar.filter).toEqual(koBar.filter);
  });

  it("carries basemapOverride into every language payload", () => {
    // The client's failure mode for a field it cannot find is to render nothing
    // for that slot, so an omission here shows up as a base map that never dims
    // rather than as an error. Asserting per language is the point: `base` is
    // spread into all three, and a field added to only one of them would still
    // pass a single-language check.
    const result = materialize(input());
    for (const lang of ["ko", "en", "zh"] as const) {
      expect(result.payloads[lang].basemapOverride).toEqual({ building_numbers: false });
    }
  });

  it("reports counts covering inputs and surviving items", () => {
    const result = materialize(
      input({
        sessions: [session(), session({ _id: "orphan", placeId: "missing" })],
      }),
    );
    expect(result.counts).toEqual({ places: 1, sessions: 2, items: 1 });
  });
});
