/**
 * Cursor design for notice list pagination.
 *
 * Cursor shape (plain, before encoding):
 *   { d: "YYYY-MM-DD", c: "<ISO>", i: "<24-hex ObjectId>" }
 *
 * Sort is {date: -1, crawledAt: -1, _id: -1}. The cursor points to the
 * last item returned on the previous page; buildCursorFilter produces the
 * $or expression that fetches strictly everything "after" it in that order.
 *
 * `_id` is included as a tiebreaker to survive crawler batches that write
 * many docs with identical crawledAt timestamps.
 */

const { ObjectId } = require("mongodb");

class InvalidCursorError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidCursorError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OID_RE = /^[0-9a-fA-F]{24}$/;

function encodeCursor({ d, c, i }) {
  return Buffer.from(JSON.stringify({ d, c, i }), "utf8").toString("base64url");
}

function decodeCursor(str) {
  if (typeof str !== "string" || str.length === 0) {
    throw new InvalidCursorError("cursor must be a non-empty string");
  }
  let json;
  try {
    json = Buffer.from(str, "base64url").toString("utf8");
  } catch {
    throw new InvalidCursorError("cursor is not valid base64url");
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidCursorError("cursor is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new InvalidCursorError("cursor is not an object");
  }
  const { d, c, i } = parsed;
  if (typeof d !== "string" || !DATE_RE.test(d)) {
    throw new InvalidCursorError("cursor.d must be YYYY-MM-DD");
  }
  if (typeof c !== "string" || Number.isNaN(Date.parse(c))) {
    throw new InvalidCursorError("cursor.c must be a parseable ISO datetime");
  }
  if (typeof i !== "string" || !OID_RE.test(i)) {
    throw new InvalidCursorError("cursor.i must be a 24-hex ObjectId");
  }
  return { d, c, i };
}

function buildCursorFilter(cursor) {
  const crawledAt = new Date(cursor.c);
  const oid = new ObjectId(cursor.i);
  return {
    $or: [
      { date: { $lt: cursor.d } },
      { date: cursor.d, crawledAt: { $lt: crawledAt } },
      { date: cursor.d, crawledAt, _id: { $lt: oid } },
    ],
  };
}

module.exports = {
  InvalidCursorError,
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
};
