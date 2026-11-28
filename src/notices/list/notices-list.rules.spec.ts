/**
 * The list's decisions: the v2 list badge (selectRoleBadge: application windows → due → happens → closed →
 * runs, rendered through the v1 brief shape the app already reads), the v1 period pick and the cursor's
 * cross-release decoding (ADR 0007: a legacy {d, c, i} cursor in app memory during a deploy must still decode).
 * On a read of several boards, each article is one row (umbrella ADR 0001): selectShownRows keeps
 * a scanned row only when it is its cluster's shown copy, the copy crawled last, then the first in list order.
 */
import type { SummaryDate } from "../notices.document";
import { encodeCursor } from "./notices-list.mapper";
import { NoticesListCursorError } from "./notices-list.error";
import { ObjectId } from "mongodb";
import { decodeCursor, hasSeveralSources, isV2Summary, selectEffectivePeriod, selectRoleBadge, selectShownRows } from "./notices-list.rules";

const NOW = new Date("2026-10-09T12:00:00+09:00");
const OID = "66a1b2c3d4e5f6a7b8c9d0e1";
const ISO = "2026-04-01T00:00:00.000Z";

function date(
  role: string,
  startAt: string | null,
  endAt: string | null,
  subject = role,
): SummaryDate {
  return { evidence: "", subject, role, endType: "range", startAt, endAt };
}

function app(...windows: { startAt: string | null; endAt: string | null; openEnded?: boolean }[]) {
  return {
    status: windows.length > 0 ? "dated" : "none",
    windows: windows.map((w) => ({ openEnded: false, ...w })),
  };
}

describe("selectRoleBadge — application windows", () => {
  it("shows an upcoming multi-day window as a range to its start", () => {
    // Arrange
    const dates = [date("apply", "2026-10-12T00:00:00+09:00", "2026-10-17T00:00:00+09:00", "1차 신청")];

    // Act
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-12T00:00:00+09:00", endAt: "2026-10-17T00:00:00+09:00" }),
      dates,
      NOW,
    );

    // Assert
    expect(badge).toEqual({
      type: "informational",
      startAt: { date: "2026-10-12", time: null },
      endAt: { date: "2026-10-16", time: null, label: "1차 신청" },
    });
  });

  it("shows an upcoming one-day window as an event at its start", () => {
    // Act
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-12T10:00:00+09:00", endAt: "2026-10-12T18:00:00+09:00" }),
      [],
      NOW,
    );

    // Assert
    expect(badge).toEqual({
      type: "event",
      startAt: { date: "2026-10-12", time: "10:00" },
      endAt: null,
    });
  });

  it("shows an upcoming window with no end as an event at its start", () => {
    // Act
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-12T09:00:00+09:00", endAt: null, openEnded: true }),
      [],
      NOW,
    );

    // Assert
    expect(badge).toEqual({
      type: "event",
      startAt: { date: "2026-10-12", time: "09:00" },
      endAt: null,
    });
  });

  it("counts an open window down to its end, labeled by the date it came from", () => {
    // Arrange
    const dates = [
      date("apply", "2026-10-01T00:00:00+09:00", "2026-10-14T00:00:00+09:00", "1차 신청"),
      date("happens", "2026-10-10T00:00:00+09:00", "2026-10-11T00:00:00+09:00", "설명회"),
    ];

    // Act
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-14T00:00:00+09:00" }),
      dates,
      NOW,
    );

    // Assert
    // An end stored as next-day 00:00 is the end of the day before.
    expect(badge).toEqual({
      type: "action_required",
      startAt: { date: "2026-10-01", time: null },
      endAt: { date: "2026-10-13", time: null, label: "1차 신청" },
    });
  });

  it("keeps a written end time and has no start for an end-only window", () => {
    // Act
    const badge = selectRoleBadge(
      app({ startAt: null, endAt: "2026-10-13T18:00:00+09:00" }),
      [date("due", null, "2026-10-13T18:00:00+09:00", "서류 제출")],
      NOW,
    );

    // Assert
    expect(badge).toEqual({
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-10-13", time: "18:00", label: "서류 제출" },
    });
  });

  it("falls back to the date with the same end when the window was merged", () => {
    // Act
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-05T00:00:00+09:00", endAt: "2026-10-20T00:00:00+09:00" }),
      [date("apply", "2026-10-07T00:00:00+09:00", "2026-10-20T00:00:00+09:00", "추가 신청")],
      NOW,
    );

    // Assert
    expect(badge.endAt).toEqual({ date: "2026-10-19", time: null, label: "추가 신청" });
  });

  it("leaves the label null when no date matches the window", () => {
    // Act
    const badge = selectRoleBadge(
      app({ startAt: null, endAt: "2026-10-20T00:00:00+09:00" }),
      [date("apply", null, "2026-10-21T00:00:00+09:00")],
      NOW,
    );

    // Assert
    expect(badge.endAt).toEqual({ date: "2026-10-19", time: null, label: null });
  });

  it("skips a passed window and picks the next one by end", () => {
    // Act
    const badge = selectRoleBadge(
      app(
        { startAt: "2026-10-20T00:00:00+09:00", endAt: "2026-10-25T00:00:00+09:00" },
        { startAt: "2026-09-01T00:00:00+09:00", endAt: "2026-09-10T00:00:00+09:00" },
      ),
      [],
      NOW,
    );

    // Assert
    expect(badge.type).toBe("informational");
    expect(badge.startAt).toEqual({ date: "2026-10-20", time: null });
  });

  it("holds an open-ended window with no badge for 30 days after it opens", () => {
    // Act
    const open = { startAt: "2026-09-29T00:00:00+09:00", endAt: null, openEnded: true };

    // Assert
    expect(selectRoleBadge(app(open), [], NOW)).toEqual({
      type: "action_required",
      startAt: { date: "2026-09-29", time: null },
      endAt: null,
    });

    const stale = { startAt: "2026-08-01T00:00:00+09:00", endAt: null, openEnded: true };
    expect(selectRoleBadge(app(stale), [], NOW)).toEqual({
      type: "action_required",
      startAt: null,
      endAt: null,
    });
  });

  it("puts an open window ahead of an earlier due", () => {
    // Act
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-20T00:00:00+09:00" }),
      [date("due", null, "2026-10-10T00:00:00+09:00", "납부")],
      NOW,
    );

    // Assert
    expect(badge.endAt?.date).toBe("2026-10-19");
  });
});

describe("selectRoleBadge — due, happens, closed", () => {
  it("counts down to the earliest future due", () => {
    // Act
    const badge = selectRoleBadge(
      app(),
      [
        date("due", null, "2026-10-08T00:00:00+09:00", "지난 제출"),
        date("due", null, "2026-10-30T00:00:00+09:00", "2차 제출"),
        date("due", "2026-10-12T00:00:00+09:00", "2026-10-15T17:00:00+09:00", "1차 제출"),
      ],
      NOW,
    );

    // Assert
    expect(badge).toEqual({
      type: "action_required",
      startAt: { date: "2026-10-12", time: null },
      endAt: { date: "2026-10-15", time: "17:00", label: "1차 제출" },
    });
  });

  it("puts a future due ahead of an event", () => {
    // Act
    const badge = selectRoleBadge(
      null,
      [
        date("happens", "2026-10-10T00:00:00+09:00", "2026-10-11T00:00:00+09:00"),
        date("due", null, "2026-10-20T00:00:00+09:00", "납부"),
      ],
      NOW,
    );

    // Assert
    expect(badge.type).toBe("action_required");
  });

  it("shows a one-day event at its start, dropping the same-day end", () => {
    // Act & Assert
    expect(
      selectRoleBadge(null, [date("happens", "2026-10-15T00:00:00+09:00", "2026-10-16T00:00:00+09:00")], NOW),
    ).toEqual({ type: "event", startAt: { date: "2026-10-15", time: null }, endAt: null });

    expect(
      selectRoleBadge(null, [date("happens", "2026-10-09T14:00:00+09:00", "2026-10-09T16:00:00+09:00")], NOW),
    ).toEqual({ type: "event", startAt: { date: "2026-10-09", time: "14:00" }, endAt: null });
  });

  it("keeps the end of a multi-day event and picks the earliest start", () => {
    // Act
    const badge = selectRoleBadge(
      null,
      [
        date("happens", "2026-11-01T00:00:00+09:00", "2026-11-02T00:00:00+09:00", "2회차"),
        date("happens", "2026-10-20T00:00:00+09:00", "2026-10-23T00:00:00+09:00", "축제"),
        date("happens", "2026-10-01T00:00:00+09:00", "2026-10-02T00:00:00+09:00", "지난 행사"),
      ],
      NOW,
    );

    // Assert
    expect(badge).toEqual({
      type: "event",
      startAt: { date: "2026-10-20", time: null },
      endAt: { date: "2026-10-22", time: null, label: "축제" },
    });
  });

  it("anchors an end-only event on its end", () => {
    // Act & Assert
    expect(
      selectRoleBadge(null, [date("happens", null, "2026-10-12T18:00:00+09:00", "시험")], NOW),
    ).toEqual({
      type: "event",
      startAt: null,
      endAt: { date: "2026-10-12", time: "18:00", label: "시험" },
    });
  });

  it("marks closed at the latest past end once every window and due passed", () => {
    // Act
    const badge = selectRoleBadge(
      app({ startAt: "2026-09-01T00:00:00+09:00", endAt: "2026-09-10T00:00:00+09:00" }),
      [date("due", null, "2026-09-20T18:00:00+09:00", "제출")],
      NOW,
    );

    // Assert
    expect(badge).toEqual({
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-09-20", time: "18:00", label: null },
    });
  });

  it("prefers a future event over the closed badge", () => {
    // Act
    const badge = selectRoleBadge(
      app({ startAt: "2026-09-01T00:00:00+09:00", endAt: "2026-09-10T00:00:00+09:00" }),
      [date("happens", "2026-10-15T00:00:00+09:00", "2026-10-16T00:00:00+09:00")],
      NOW,
    );

    // Assert
    expect(badge.type).toBe("event");
  });
});

describe("selectRoleBadge — runs and nothing", () => {
  it("shows a running multi-day range, in progress before upcoming", () => {
    // Act
    const badge = selectRoleBadge(
      null,
      [
        date("runs", "2026-10-20T00:00:00+09:00", "2026-11-20T00:00:00+09:00", "2차 활동"),
        date("runs", "2026-09-01T00:00:00+09:00", "2026-12-01T00:00:00+09:00", "활동"),
      ],
      NOW,
    );

    // Assert
    expect(badge).toEqual({
      type: "informational",
      startAt: { date: "2026-09-01", time: null },
      endAt: { date: "2026-11-30", time: null, label: "활동" },
    });
  });

  it("shows the earliest upcoming range when none is in progress", () => {
    // Act
    const badge = selectRoleBadge(
      null,
      [
        date("runs", "2026-11-01T00:00:00+09:00", "2026-11-10T00:00:00+09:00"),
        date("runs", "2026-10-20T00:00:00+09:00", "2026-10-25T00:00:00+09:00"),
      ],
      NOW,
    );

    // Assert
    expect(badge.startAt).toEqual({ date: "2026-10-20", time: null });
  });

  it("ignores one-day and finished ranges, results and unknown roles", () => {
    // Act
    const badge = selectRoleBadge(
      null,
      [
        date("runs", "2026-10-15T00:00:00+09:00", "2026-10-16T00:00:00+09:00"),
        date("runs", "2026-08-01T00:00:00+09:00", "2026-09-01T00:00:00+09:00"),
        date("announce", "2026-10-20T00:00:00+09:00", "2026-10-21T00:00:00+09:00"),
        date("someday", "2026-10-20T00:00:00+09:00", "2026-10-25T00:00:00+09:00"),
      ],
      NOW,
    );

    // Assert
    expect(badge).toEqual({ type: "informational", startAt: null, endAt: null });
  });

  it("tolerates malformed input without throwing", () => {
    // Act
    const junk = [
      null,
      "text",
      { role: "due", startAt: "not a date", endAt: 20261013 },
      { role: 7, startAt: null, endAt: null },
    ];

    // Assert
    expect(selectRoleBadge("dated", junk, NOW)).toEqual({
      type: "informational",
      startAt: null,
      endAt: null,
    });
    expect(selectRoleBadge({ windows: "none" }, undefined, NOW).type).toBe("informational");
    expect(selectRoleBadge({ windows: [null, { startAt: null, endAt: null }] }, [], NOW).type).toBe(
      "informational",
    );
  });
});



describe("decodeCursor — cross-release compatibility", () => {
  it("accepts a legacy {d, c, i} cursor and preserves c", () => {
    // Act
    // Minted by the previous release; in flight in app memory during deploy.
    const legacy = encodeCursor({ d: "2026-04-01", c: ISO, i: OID });

    // Assert
    expect(decodeCursor(legacy)).toEqual({ d: "2026-04-01", c: ISO, i: OID });
  });

  it("accepts a {d, i} cursor with no c at all", () => {
    // Act
    // The shape this code emits once `c` is retired (a later release).
    const slim = Buffer.from(
      JSON.stringify({ d: "2026-04-01", i: OID }),
      "utf8",
    ).toString("base64url");

    // Assert
    expect(decodeCursor(slim)).toEqual({ d: "2026-04-01", i: OID });
  });

  it("still rejects a malformed c — absent is fine, garbage is not", () => {
    // Act
    const bad = Buffer.from(
      JSON.stringify({ d: "2026-04-01", c: "not-a-date", i: OID }),
      "utf8",
    ).toString("base64url");

    // Assert
    expect(() => decodeCursor(bad)).toThrow(NoticesListCursorError);
  });
});

describe("decodeCursor — every stored date shape", () => {
  // EVIDENCE: prod notices store `date` as YYYY-MM-DD (10,177 docs) and, for boards crawled before 2026-08-06,
  // as YYYY-MM-DD HH:mm (868 docs, sscience-undergrad, liberalarts-undergrad, …); sampled 2026-10-15.
  it.each(["2026-08-05", "2026-07-21 11:15", "2026-03-09 00:00"])("round-trips a cursor minted on %s", (stored) => {
    // Arrange
    const minted = encodeCursor({ d: stored, c: ISO, i: OID });

    // Act
    const decoded = decodeCursor(minted);

    // Assert
    expect(decoded).toEqual({ d: stored, c: ISO, i: OID });
  });

  it.each(["", "2026-07-21T11:15", "2026-07-21 11:15:00", "2026-07-21 1:15", "2026-7-21", "2026-07-21 "])(
    "rejects %j, a shape the crawler never stores",
    (day) => {
      // Arrange
      const cursor = Buffer.from(JSON.stringify({ d: day, i: OID }), "utf8").toString("base64url");

      // Act & Assert
      expect(() => decodeCursor(cursor)).toThrow(NoticesListCursorError);
    },
  );
});

describe("selectEffectivePeriod", () => {
  const NOW_V1 = new Date("2026-10-09T12:00:00+09:00");
  const periods = [
    { label: "past", startDate: "2026-10-01", endDate: "2026-10-05" },
    { label: "slot", startDate: "2026-10-10", endDate: "2026-10-10", endTime: "13:00" },
    { label: "next", startDate: "2026-10-01", endDate: "2026-10-12" },
    { label: "later", endDate: "2026-10-20" },
  ];

  it("takes the first period for event and informational", () => {
    // Act & Assert
    expect([selectEffectivePeriod(periods, "event", NOW_V1)?.label, selectEffectivePeriod(periods, "informational", NOW_V1)?.label]).toEqual([
      "past",
      "past",
    ]);
  });

  it("takes the next deadline for action_required, skipping a same-day time slot", () => {
    // Act & Assert
    expect(selectEffectivePeriod(periods, "action_required", NOW_V1)?.label).toBe("next");
  });

  it("falls back to the most recently passed deadline once all have passed", () => {
    // Act & Assert
    expect(selectEffectivePeriod(periods.slice(0, 1), "action_required", NOW_V1)?.label).toBe("past");
  });

  it("returns null for no periods, a non-array or no deadline at all", () => {
    // Act & Assert
    expect([selectEffectivePeriod([], "event", NOW_V1), selectEffectivePeriod(null, "event", NOW_V1), selectEffectivePeriod([{ label: "x" }], "action_required", NOW_V1)]).toEqual([null, null, null]);
  });
});

describe("isV2Summary", () => {
  it.each([
    [{ summaryVersion: 2, summaryDates: [] }, true],
    [{ summaryVersion: 3, summaryDates: [] }, true],
    [{ summaryVersion: 1, summaryDates: [] }, false],
    [{ summaryVersion: 2 }, false],
    [{}, false],
  ])("%j → %j", (doc, expected) => {
    // Act & Assert
    expect(isV2Summary(doc)).toBe(expected);
  });
});

describe("hasSeveralSources", () => {
  it.each([
    ["one source by path", "skku-notice03", false],
    ["one source in a list", ["skku-notice03"], false],
    ["one source named twice", ["skku-notice03", "skku-notice03"], false],
    ["two sources", ["skku-notice03", "skku-notice08"], true],
  ])("is %s: %s", (_case, scope, expected) => {
    // Act & Assert
    expect(hasSeveralSources(scope)).toBe(expected);
  });
});

describe("selectShownRows", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));
  const crawled = (hour: number) => new Date(`2026-10-20T${String(hour).padStart(2, "0")}:00:00Z`);
  // A batch is in list order: date desc, then _id desc.
  const copy = (n: number, dupOf?: number, hour = 1) => ({ _id: id(n), crawledAt: crawled(hour), ...(dupOf === undefined ? {} : { dupOf: id(dupOf) }) });
  const ids = (rows: Array<{ _id: ObjectId }>) => rows.map((row) => row._id.toHexString());
  const keys = (...ns: number[]) => new Set(ns.map((n) => id(n).toHexString()));

  it("keeps the first copy in list order and drops the later copies of its cluster", () => {
    // Arrange
    const batch = [copy(3, 1), copy(2, 1), copy(1, 1)];

    // Act & Assert
    expect(ids(selectShownRows(batch, keys()))).toEqual([id(3).toHexString()]);
  });

  it("keeps the first copy though a later copy was crawled after it", () => {
    // Arrange
    const batch = [copy(3, 1, 1), copy(2, 1, 9)];

    // Act & Assert
    expect(ids(selectShownRows(batch, keys()))).toEqual([id(3).toHexString()]);
  });

  it("drops every row of a cluster that a decided key holds, as an earlier page or scan served it", () => {
    // Arrange
    const batch = [copy(3, 1), copy(2, 1)];

    // Act & Assert
    expect(selectShownRows(batch, keys(1))).toEqual([]);
  });

  it("keeps a row whose cluster no decided key holds", () => {
    // Arrange
    const batch = [copy(2, 1)];

    // Act & Assert
    expect(ids(selectShownRows(batch, keys(9)))).toEqual([id(2).toHexString()]);
  });

  it("keeps the first row of each cluster in batch order across interleaved clusters", () => {
    // Arrange
    const batch = [copy(6, 101), copy(5, 104), copy(4, 101), copy(3, 107), copy(2, 104), copy(1)];

    // Act & Assert
    expect(ids(selectShownRows(batch, keys(107)))).toEqual([id(6), id(5), id(1)].map((oid) => oid.toHexString()));
  });

  it("keys a notice the crawler has not linked yet on its own _id", () => {
    // Arrange
    const batch = [copy(2), copy(1)];

    // Act & Assert
    expect(ids(selectShownRows(batch, keys(1)))).toEqual([id(2).toHexString()]);
  });

  it("collapses copies on one board too, since it compares copies and never their boards", () => {
    // Arrange
    const batch = [
      { ...copy(2, 1), sourceId: "skku-notice03" },
      { ...copy(1, 1), sourceId: "skku-notice03" },
    ];

    // Act & Assert
    expect(ids(selectShownRows(batch, keys()))).toEqual([id(2).toHexString()]);
  });
});
