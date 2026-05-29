const { ObjectId } = require("mongodb");
const {
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
  InvalidCursorError,
} = require("../features/notices/notices.cursor");

describe("encodeCursor / decodeCursor", () => {
  const sample = {
    d: "2026-04-09",
    c: "2026-04-09T11:22:33.000Z",
    i: "66a1b2c3d4e5f6a7b8c9d0e1",
  };

  it("round-trips a valid cursor", () => {
    const encoded = encodeCursor(sample);
    expect(typeof encoded).toBe("string");
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(sample);
  });

  it("encoded string is base64url-safe (no +, /, =)", () => {
    const encoded = encodeCursor(sample);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("throws InvalidCursorError on non-base64 garbage", () => {
    expect(() => decodeCursor("!!!not-base64!!!")).toThrow(InvalidCursorError);
  });

  it("throws InvalidCursorError on valid base64 but invalid JSON", () => {
    const badJson = Buffer.from("{not json", "utf8").toString("base64url");
    expect(() => decodeCursor(badJson)).toThrow(InvalidCursorError);
  });

  it("throws on missing fields", () => {
    const missing = Buffer.from(JSON.stringify({ d: "2026-04-09" }), "utf8").toString("base64url");
    expect(() => decodeCursor(missing)).toThrow(InvalidCursorError);
  });

  it("throws on malformed date `d`", () => {
    const bad = Buffer.from(JSON.stringify({ ...sample, d: "not-a-date" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });

  it("throws on malformed ObjectId `i`", () => {
    const bad = Buffer.from(JSON.stringify({ ...sample, i: "xyz" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });

  it("throws on unparseable `c`", () => {
    const bad = Buffer.from(JSON.stringify({ ...sample, c: "not-iso" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });
});

describe("buildCursorFilter", () => {
  const cursor = {
    d: "2026-04-09",
    c: "2026-04-09T11:22:33.000Z",
    i: "66a1b2c3d4e5f6a7b8c9d0e1",
  };

  it("returns an $or with exactly 3 branches", () => {
    const filter = buildCursorFilter(cursor);
    expect(filter).toHaveProperty("$or");
    expect(filter.$or).toHaveLength(3);
  });

  it("first branch: date < d", () => {
    const filter = buildCursorFilter(cursor);
    expect(filter.$or[0]).toEqual({ date: { $lt: "2026-04-09" } });
  });

  it("second branch: date == d AND crawledAt < c (as Date)", () => {
    const filter = buildCursorFilter(cursor);
    expect(filter.$or[1].date).toBe("2026-04-09");
    expect(filter.$or[1].crawledAt.$lt).toBeInstanceOf(Date);
    expect(filter.$or[1].crawledAt.$lt.toISOString()).toBe("2026-04-09T11:22:33.000Z");
  });

  it("third branch: date == d AND crawledAt == c AND _id < i (as ObjectId)", () => {
    const filter = buildCursorFilter(cursor);
    expect(filter.$or[2].date).toBe("2026-04-09");
    expect(filter.$or[2].crawledAt).toBeInstanceOf(Date);
    expect(filter.$or[2]._id.$lt).toBeInstanceOf(ObjectId);
    expect(filter.$or[2]._id.$lt.toHexString()).toBe("66a1b2c3d4e5f6a7b8c9d0e1");
  });
});

describe("InvalidCursorError", () => {
  it("is an Error subclass with a distinct name", () => {
    const err = new InvalidCursorError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidCursorError");
    expect(err.message).toBe("boom");
  });
});
