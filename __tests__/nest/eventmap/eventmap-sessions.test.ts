/**
 * scripts/lib/eventmap-sessions.js — the authored line-up reader.
 *
 * The sibling of eventmap-csv.test.ts, and written the same way: every case is a
 * shape the file has been or can trivially be wrong in, and every expected value
 * was taken from a live probe of the module rather than assumed — including the
 * ones that look obvious, because `Date.parse("2026-09-16")` is UTC midnight and
 * a Seoul-authored time silently moves nine hours if that is not caught.
 *
 * The module is pure given (text, layerSetId, now), which is why it can be
 * required directly. The executable script keeps main() behind
 * require.main === module.
 */
import fs from "fs";
import path from "path";

// scripts/ is excluded from tsconfig (plain CommonJS operator tooling), so this
// is a require rather than an import.
const {
  parseSessionsJson,
  seoulDate,
} = require("../../../scripts/lib/eventmap-sessions");

const LAYER_SET_ID = "test-set";

/** Fixed instant so every expectation below is deterministic. 12:00 KST. */
const NOW = new Date("2026-08-27T03:00:00Z");

const REAL_FILE = path.join(
  __dirname,
  "../../../scripts/data/eskara-2026-sessions.json",
);

interface Doc {
  _id: string;
  placeId: string;
  campus: string;
  category: string;
  lifecycle: string;
  dayIndex: number | null;
  date: string | null;
  slot: string | null;
  startAt: Date | null;
  endAt: Date | null;
  title: Record<string, string>;
  subtitle: Record<string, string> | null;
  hoursLabel: Record<string, string> | null;
  tenant: { id: string | null; name: Record<string, string>; kind: string };
  actions: Array<{ id: string; actionType: string; actionValue: string }>;
  media: { thumbnailUrl: string | null; images: string[] };
  tags: string[];
  order: number;
  fields?: Record<string, unknown>;
}

interface Parsed {
  docs: Doc[];
  errors: Array<{ index: number | null; id: string | null; message: string }>;
  timeBase: string | null;
}

/** One minimal session, overridable field by field. */
function file(session: Record<string, unknown>, top: Record<string, unknown> = {}): string {
  return JSON.stringify({
    layerSetId: LAYER_SET_ID,
    timeBase: "relative",
    campus: "nsc",
    ...top,
    sessions: [
      {
        id: "a",
        placeId: "nsc-p",
        title: "제목",
        category: "booth",
        tenantName: "학생회",
        tenantKind: "council",
        ...session,
      },
    ],
  });
}

function parse(text: string, now: Date = NOW): Parsed {
  return parseSessionsJson(text, { layerSetId: LAYER_SET_ID, now });
}

function firstError(text: string, now: Date = NOW): string {
  const { errors } = parse(text, now);
  expect(errors.length).toBeGreaterThan(0);
  return errors[0].message;
}

describe("parseSessionsJson — the committed line-up", () => {
  const real = (): Parsed =>
    parseSessionsJson(fs.readFileSync(REAL_FILE, "utf8"), {
      layerSetId: "eskara-2026",
      now: NOW,
    });

  it("parses with zero rejections", () => {
    const { docs, errors } = real();

    expect(errors).toEqual([]);
    expect(docs.length).toBeGreaterThan(0);
  });

  // Counts are NOT asserted: this file is a verification dataset that the real
  // 2026 line-up replaces wholesale. What must survive that replacement is the
  // coverage — a dataset that exercises only one branch of the status table
  // proves nothing about the pipeline, and that is the failure this guards.
  it("covers every category the layer config draws", () => {
    const categories = new Set(real().docs.map((d) => d.category));

    // src/map/config/eskara-2026.json itemDefaults.byCategory — a category with
    // no entry lands on the fallback layer, so a missing one is easy to miss.
    expect([...categories].sort()).toEqual(["bar", "booth", "facility", "food", "stage"]);
  });

  it("covers every lifecycle branch, including the two that must not materialize", () => {
    const lifecycles = new Set(real().docs.map((d) => d.lifecycle));

    expect(lifecycles).toContain("published");
    // §6.2 step 6b: a cancelled booth materializes as visibly closed rather than
    // vanishing, because people walk to a booth that is silently absent.
    expect(lifecycles).toContain("cancelled");
    expect(lifecycles).toContain("draft");
    expect(lifecycles).toContain("hidden");
  });

  it("covers both windows the client must NOT recompute against its own clock", () => {
    const docs = real().docs;

    // §9: both bounds null is an always-on facility.
    expect(docs.some((d) => d.startAt === null && d.endAt === null)).toBe(true);
    // A one-sided window is permanently "unknown" — the other branch.
    expect(docs.some((d) => (d.startAt === null) !== (d.endAt === null))).toBe(true);
  });

  it("puts more than one occupant on at least one plot", () => {
    const perPlace = new Map<string, number>();
    for (const doc of real().docs) {
      perPlace.set(doc.placeId, (perPlace.get(doc.placeId) ?? 0) + 1);
    }

    // stackKeyBy is "placeId", so a shared plot is what exercises the marker
    // merge. The 2025 부스전 sheet numbered two booths 2 and two booths 4.
    expect([...perPlace.values()].some((n) => n > 1)).toBe(true);
  });

  it("never names a webview host — the materializer joins WEBVIEW_ORIGIN", () => {
    const webviewValues = real()
      .docs.flatMap((d) => d.actions)
      .filter((a) => a.actionType === "webview")
      .map((a) => a.actionValue);

    expect(webviewValues.length).toBeGreaterThan(0);
    for (const value of webviewValues) expect(value.startsWith("/")).toBe(true);
  });
});

describe("parseSessionsJson — days expansion", () => {
  it("expands [1, 2] into two documents a day apart, suffixing the id", () => {
    const { docs } = parse(file({ days: [1, 2], startOffsetMin: 0, endOffsetMin: 60 }));

    expect(docs.map((d) => d._id)).toEqual(["test-set-a-d1", "test-set-a-d2"]);
    expect(docs.map((d) => d.dayIndex)).toEqual([1, 2]);
    // A SessionDoc is ONE occupancy interval, so a 양일주점 is two documents —
    // and the second one has to actually sit a day later, not merely be labelled
    // day 2.
    expect(docs[1].startAt!.getTime() - docs[0].startAt!.getTime()).toBe(86_400_000);
  });

  it("stamps the civil Seoul date per expanded day", () => {
    const { docs } = parse(file({ days: [1, 2], startOffsetMin: 0 }));

    expect(docs.map((d) => d.date)).toEqual(["2026-08-27", "2026-08-28"]);
  });

  it("uses the Seoul civil date, not the UTC one", () => {
    // 15:30Z is 00:30 the NEXT day in Asia/Seoul. A UTC-derived date would say
    // the 27th and put a whole night of sessions on the wrong festival day.
    const lateUtc = new Date("2026-08-27T15:30:00Z");

    expect(seoulDate(lateUtc)).toBe("2026-08-28");
    expect(parse(file({ days: [1], startOffsetMin: 0 }), lateUtc).docs[0].date).toBe(
      "2026-08-28",
    );
  });

  it("leaves the id unsuffixed and the day null when days is omitted", () => {
    const { docs } = parse(file({}));

    expect(docs).toHaveLength(1);
    expect(docs[0]._id).toBe("test-set-a");
    expect(docs[0].dayIndex).toBeNull();
    expect(docs[0].date).toBeNull();
    // Omitting the window entirely is how an always-on facility is expressed.
    expect(docs[0].startAt).toBeNull();
    expect(docs[0].endAt).toBeNull();
  });

  it("rejects a repeated day rather than writing one document twice", () => {
    expect(firstError(file({ days: [1, 1] }))).toMatch(/days\[\] repeats 1/);
  });

  it("rejects an explicit date alongside a multi-day expansion", () => {
    // One date cannot describe both documents, and silently applying it to both
    // would put day 2's sessions on day 1's date.
    expect(firstError(file({ days: [1, 2], date: "2026-09-16" }))).toMatch(
      /date cannot be set when days has more than one entry/,
    );
  });
});

describe("parseSessionsJson — time base", () => {
  it("resolves relative offsets against the supplied now", () => {
    const { docs } = parse(file({ startOffsetMin: -30, endOffsetMin: 90 }));

    expect(docs[0].startAt!.toISOString()).toBe("2026-08-27T02:30:00.000Z");
    expect(docs[0].endAt!.toISOString()).toBe("2026-08-27T04:30:00.000Z");
  });

  it("is deterministic for a given now", () => {
    const text = file({ days: [1, 2], startOffsetMin: -30, endOffsetMin: 90 });

    expect(JSON.stringify(parse(text).docs)).toBe(JSON.stringify(parse(text).docs));
  });

  it("refuses instants in a relative file and offsets in an absolute one", () => {
    expect(firstError(file({ startAt: "2026-09-16T18:00:00+09:00" }))).toMatch(
      /startAt is not allowed when timeBase is "relative"/,
    );
    expect(
      firstError(file({ startOffsetMin: 0 }, { timeBase: "absolute" })),
    ).toMatch(/startOffsetMin is not allowed when timeBase is "absolute"/);
  });

  it("rejects a date or a naive datetime, demanding an explicit zone", () => {
    // Date.parse("2026-09-16") is UTC midnight, so a Seoul author writing a bare
    // date gets a time nine hours off with no error anywhere in the pipeline.
    // Both of these are accepted by Date.parse and rejected here.
    for (const value of ["2026-09-16", "2026-09-16T18:00:00"]) {
      expect(firstError(file({ startAt: value }, { timeBase: "absolute" }))).toMatch(
        /must be an ISO instant with an explicit offset or Z/,
      );
    }
  });

  it("accepts an offset and a Z instant as the same moment", () => {
    const withOffset = parse(
      file({ startAt: "2026-09-16T18:00:00+09:00" }, { timeBase: "absolute" }),
    );
    const withZ = parse(
      file({ startAt: "2026-09-16T09:00:00Z" }, { timeBase: "absolute" }),
    );

    expect(withOffset.docs[0].startAt!.toISOString()).toBe("2026-09-16T09:00:00.000Z");
    expect(withZ.docs[0].startAt!.toISOString()).toBe("2026-09-16T09:00:00.000Z");
  });

  it("rejects an end at or before its start", () => {
    expect(firstError(file({ startOffsetMin: 60, endOffsetMin: 60 }))).toMatch(
      /endOffsetMin must be after startOffsetMin/,
    );
  });

  it("rejects a non-integer offset", () => {
    // 1.5 minutes is not a thing an author means, and Number() would take it.
    expect(firstError(file({ startOffsetMin: 1.5 }))).toMatch(
      /startOffsetMin must be an integer/,
    );
  });
});

describe("parseSessionsJson — whole-file rejections", () => {
  it("names the JSON syntax error rather than throwing", () => {
    expect(firstError("{ not json")).toMatch(/JSON could not be parsed/);
  });

  it("refuses to import one event's sessions into another", () => {
    // The importer is run with --layer-set-id; a mismatch means the operator
    // pointed it at the wrong file, and writing it would mix two events' pins.
    expect(firstError(file({}, { layerSetId: "other-event" }))).toMatch(
      /does not match --layer-set-id/,
    );
  });

  it("requires a known timeBase", () => {
    expect(firstError(file({}, { timeBase: "" }))).toMatch(/timeBase must be one of/);
    expect(firstError(file({}, { timeBase: "epoch" }))).toMatch(/timeBase must be one of/);
  });

  it("requires a known campus", () => {
    expect(firstError(file({}, { campus: "kingo" }))).toMatch(/campus must be one of/);
  });

  it("rejects an empty sessions array", () => {
    expect(
      firstError(JSON.stringify({ layerSetId: LAYER_SET_ID, timeBase: "relative", sessions: [] })),
    ).toMatch(/sessions must be a non-empty array/);
  });
});

describe("parseSessionsJson — per-entry rejections", () => {
  const two = (a: Record<string, unknown>, b: Record<string, unknown>): string =>
    JSON.stringify({
      layerSetId: LAYER_SET_ID,
      timeBase: "relative",
      sessions: [
        { id: "a", placeId: "p", title: "T", category: "booth", tenantName: "N", tenantKind: "k", ...a },
        { id: "b", placeId: "p", title: "T", category: "booth", tenantName: "N", tenantKind: "k", ...b },
      ],
    });

  it("rejects a duplicate id", () => {
    expect(firstError(two({}, { id: "a" }))).toMatch(/duplicate id/);
  });

  it("collects every bad entry, not just the first", () => {
    const { errors } = parse(two({ id: "" }, { placeId: "" }));

    // The importer prints all of them and writes nothing, so an operator fixes
    // the file in one pass instead of one error per run.
    expect(errors).toHaveLength(2);
  });

  it("rejects a blank required field", () => {
    expect(firstError(file({ title: "  " }))).toMatch(/title is blank/);
    expect(firstError(file({ placeId: "" }))).toMatch(/placeId is blank/);
    expect(firstError(file({ category: "" }))).toMatch(/category is blank/);
    expect(firstError(file({ tenantKind: "" }))).toMatch(/tenantKind is blank/);
  });

  it("rejects an unknown lifecycle", () => {
    expect(firstError(file({ lifecycle: "retired" }))).toMatch(/lifecycle must be one of/);
  });

  it("defaults lifecycle to published and tenant.id to null", () => {
    const { docs } = parse(file({}));

    expect(docs[0].lifecycle).toBe("published");
    // A soft tenant slug is optional — §4.2 keeps the upgrade path open without
    // requiring one.
    expect(docs[0].tenant.id).toBeNull();
  });
});

describe("parseSessionsJson — i18n", () => {
  it("treats a bare string as Korean, matching the places sheet", () => {
    const { docs } = parse(file({ title: "부스" }));

    expect(docs[0].title).toEqual({ ko: "부스" });
  });

  it("passes an object through, dropping blank languages", () => {
    const { docs } = parse(file({ title: { ko: "부스", en: "Booth", zh: "  " } }));

    expect(docs[0].title).toEqual({ ko: "부스", en: "Booth" });
  });

  it("rejects a value blank in every language", () => {
    // This is what the materializer's hasAnyText rejects later; catching it here
    // names the entry instead of the snapshot.
    expect(firstError(file({ title: { ko: "", en: "" } }))).toMatch(
      /title is blank in every language/,
    );
  });

  it("rejects an unsupported language key", () => {
    // A fourth language needs infra/i18n.ts and the wire format too, so silently
    // dropping it here would lose content with no error anywhere.
    expect(firstError(file({ title: { ko: "부스", ja: "ブース" } }))).toMatch(
      /unsupported language key\(s\) \[ja\]/,
    );
  });
});

describe("parseSessionsJson — actions", () => {
  const withAction = (action: Record<string, unknown>): string =>
    file({ actions: [{ id: "x", label: "라벨", actionType: "webview", actionValue: "/eskara/entry", ...action }] });

  it("keeps a root-relative webview value verbatim", () => {
    const { docs } = parse(withAction({}));

    // resolveActions joins WEBVIEW_ORIGIN at materialize time, so the stored
    // value stays relative and the wire value is absolute.
    expect(docs[0].actions[0].actionValue).toBe("/eskara/entry");
  });

  it("rejects a webview action that names a host", () => {
    // A host written here is a second place the origin lives, which is exactly
    // how a stale one reached production once already.
    expect(firstError(withAction({ actionValue: "https://webview.skkuverse.com/eskara/entry" }))).toMatch(
      /must be root-relative for a webview action/,
    );
  });

  it("rejects an unknown action type", () => {
    expect(firstError(withAction({ actionType: "deeplink" }))).toMatch(
      /actionType must be one of/,
    );
  });

  it("rejects a duplicate action id within one session", () => {
    expect(
      firstError(
        file({
          actions: [
            { id: "x", label: "A", actionType: "external", actionValue: "https://www.skku.edu/" },
            { id: "x", label: "B", actionType: "external", actionValue: "https://www.skku.edu/" },
          ],
        }),
      ),
    ).toMatch(/is used twice in the same session/);
  });

  it("allows whitespace and newlines in a content action", () => {
    // `content` is prose shown in the sheet, not a value handed to an opener.
    const { docs } = parse(
      withAction({ actionType: "content", actionValue: "도장 4개\n추첨 볼 1개" }),
    );

    expect(docs[0].actions[0].actionValue).toBe("도장 4개\n추첨 볼 1개");
  });

  it("rejects a blank actionValue for every type", () => {
    expect(firstError(withAction({ actionValue: "   " }))).toMatch(/actionValue is blank/);
    expect(
      firstError(withAction({ actionType: "content", actionValue: "  \n " })),
    ).toMatch(/actionValue is blank/);
  });
});

describe("parseSessionsJson — fields and media", () => {
  it("carries a menu through to the card template's field slot", () => {
    const { docs } = parse(file({ fields: { menu: "부추전 · 막걸리" } }));

    expect(docs[0].fields).toEqual({ menu: { ko: "부추전 · 막걸리" } });
  });

  it("passes a number through unwrapped", () => {
    const { docs } = parse(file({ fields: { price: 8000 } }));

    expect(docs[0].fields).toEqual({ price: 8000 });
  });

  it("refuses the reserved cancelled field", () => {
    // The materializer writes fields.cancelled for a cancelled session, so an
    // authored one is silently overwritten for the one lifecycle it matters in.
    expect(firstError(file({ fields: { cancelled: "취소됨" } }))).toMatch(
      /fields\.cancelled is reserved/,
    );
  });

  it("omits fields entirely when there are none", () => {
    expect(parse(file({})).docs[0]).not.toHaveProperty("fields");
  });

  it("defaults media to an empty bundle", () => {
    expect(parse(file({})).docs[0].media).toEqual({ thumbnailUrl: null, images: [] });
  });
});
