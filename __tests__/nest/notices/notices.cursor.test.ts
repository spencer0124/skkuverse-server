/**
 * Unit coverage for the notice-list pagination cursor (skkuverse#52, ADR 0007).
 *
 * The sort key moved from {date, crawledAt, _id} to {date, _id} because the
 * crawler rewrites `crawledAt` on every unchanged page-0 notice every 30
 * minutes — two notices sharing a (day-granular) `date` swapped places
 * between ticks, which is what makes a cursor skip or repeat a row.
 *
 * Two properties are safety-critical and both are pinned here:
 *   - `crawledAt` must not appear in the filter, or the flip comes back;
 *   - a legacy {d, c, i} cursor must still decode. Those are live in app
 *     memory during any deploy, and rejecting one 400s a user mid-scroll.
 */

import { ObjectId } from "mongodb";
import {
  InvalidCursorError,
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
} from "../../../src/notices/notices.cursor";

const OID = "66a1b2c3d4e5f6a7b8c9d0e1";
const ISO = "2026-04-01T00:00:00.000Z";

describe("buildCursorFilter", () => {
  it("pages on (date, _id) only — never on crawledAt", () => {
    const filter = buildCursorFilter({ d: "2026-04-01", c: ISO, i: OID });

    expect(filter).toEqual({
      $or: [
        { date: { $lt: "2026-04-01" } },
        { date: "2026-04-01", _id: { $lt: new ObjectId(OID) } },
      ],
    });
    // Belt and braces: a future edit that reintroduces the key anywhere in
    // the filter tree reopens the ordering flip, so assert on the whole shape.
    expect(JSON.stringify(filter)).not.toContain("crawledAt");
  });

  it("ignores a legacy `c` rather than letting it narrow the page", () => {
    const withC = buildCursorFilter({ d: "2026-04-01", c: ISO, i: OID });
    const withoutC = buildCursorFilter({ d: "2026-04-01", i: OID });
    expect(withC).toEqual(withoutC);
  });
});

describe("decodeCursor — cross-release compatibility", () => {
  it("accepts a legacy {d, c, i} cursor and preserves c", () => {
    // Minted by the previous release; in flight in app memory during deploy.
    const legacy = encodeCursor({ d: "2026-04-01", c: ISO, i: OID });
    expect(decodeCursor(legacy)).toEqual({ d: "2026-04-01", c: ISO, i: OID });
  });

  it("accepts a {d, i} cursor with no c at all", () => {
    // The shape this code emits once `c` is retired (a later release).
    const slim = Buffer.from(
      JSON.stringify({ d: "2026-04-01", i: OID }),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(slim)).toEqual({ d: "2026-04-01", i: OID });
  });

  it("still rejects a malformed c — absent is fine, garbage is not", () => {
    const bad = Buffer.from(
      JSON.stringify({ d: "2026-04-01", c: "not-a-date", i: OID }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });
});

describe("encodeCursor", () => {
  it("still emits c, so a cursor minted here survives a rollback", () => {
    const encoded = encodeCursor({ d: "2026-04-01", c: ISO, i: OID });
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString());
    expect(decoded).toEqual({ d: "2026-04-01", c: ISO, i: OID });
  });

  it("round-trips through decodeCursor", () => {
    const payload = { d: "2026-04-01", c: ISO, i: OID };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });
});
