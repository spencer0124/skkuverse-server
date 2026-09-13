/**
 * Cursor design for notice list pagination.
 *
 * Cursor shape (plain, before encoding):
 *   { d: "YYYY-MM-DD", c?: "<ISO>", i: "<24-hex ObjectId>" }
 *
 * Sort is {date: -1, _id: -1}. The cursor points to the last item returned
 * on the previous page; buildCursorFilter produces the $or expression that
 * fetches strictly everything "after" it in that order.
 *
 * `crawledAt` used to sit between the two as the second sort key. It could
 * not stay: the crawler rewrites it on every unchanged page-0 notice every
 * 30 minutes, so two notices sharing a (day-granular) `date` swapped places
 * between ticks — exactly the state that makes a cursor skip or repeat a
 * row mid-scroll. Measured on prod 2026-09-06: 39 (sourceId, date) groups
 * spanning 247 documents held both touched and untouched rows at once.
 * `_id` replaces it: already the tiebreaker for that same reason, already a
 * total order, and never rewritten. See ADR 0007.
 *
 * `c` is retained in the payload but no longer read. encodeCursor still
 * emits it and decodeCursor still accepts it, so a cursor minted by this
 * code stays decodable by the previous release — that is what makes a
 * rollback safe while cursors are in flight in app memory. Retiring it is a
 * separate release, once no server that requires it can receive one.
 */
import { ObjectId } from "mongodb";
import type { CursorPayload } from "./types";

class InvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCursorError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OID_RE = /^[0-9a-fA-F]{24}$/;

function encodeCursor({ d, c, i }: CursorPayload): string {
  return Buffer.from(JSON.stringify({ d, c, i }), "utf8").toString("base64url");
}

function decodeCursor(str: unknown): CursorPayload {
  if (typeof str !== "string" || str.length === 0) {
    throw new InvalidCursorError("cursor must be a non-empty string");
  }
  let json: string;
  try {
    json = Buffer.from(str, "base64url").toString("utf8");
  } catch {
    throw new InvalidCursorError("cursor is not valid base64url");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidCursorError("cursor is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new InvalidCursorError("cursor is not an object");
  }
  const { d, c, i } = parsed as Partial<CursorPayload>;
  if (typeof d !== "string" || !DATE_RE.test(d)) {
    throw new InvalidCursorError("cursor.d must be YYYY-MM-DD");
  }
  // `c` is legacy and unread, but a malformed one still means a corrupt
  // cursor — validate when present, accept when absent. Absent is the shape
  // this code will emit once the field is retired; present is every cursor
  // currently in flight.
  if (c !== undefined && (typeof c !== "string" || Number.isNaN(Date.parse(c)))) {
    throw new InvalidCursorError("cursor.c must be a parseable ISO datetime");
  }
  if (typeof i !== "string" || !OID_RE.test(i)) {
    throw new InvalidCursorError("cursor.i must be a 24-hex ObjectId");
  }
  return c === undefined ? { d, i } : { d, c, i };
}

// Return type left inferred to avoid `import type { Filter } from "mongodb"`
// which triggers TS2497 against mongodb v7's namespace-style type exports
// (same workaround used in PR2 bus/busCache.ts).
function buildCursorFilter(cursor: CursorPayload) {
  const oid = new ObjectId(cursor.i);
  // cursor.c is deliberately not read — see the module docstring.
  return {
    $or: [
      { date: { $lt: cursor.d } },
      { date: cursor.d, _id: { $lt: oid } },
    ],
  };
}

export { InvalidCursorError, encodeCursor, decodeCursor, buildCursorFilter };
