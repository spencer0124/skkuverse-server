/**
 * The v2 list routes' input: the source or sources first, then the limit (parseInt clamped to 1 to 50, 20 by default),
 * the cursor (an empty one means none, a malformed one is refused) and the search text (trimmed, or dropped, never an
 * error). There is no `type`: it is not read, whatever it holds.
 */
import { multiListRequestV2, sourceListRequestV2 } from "./notices-v2-list.schema";

const OID = "66a1b2c3d4e5f6a7b8c9d0e1";
const mint = (payload: unknown): string => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const firstIssue = (result: { error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }): unknown => {
  const issue = result.error?.issues[0];
  return issue ? [issue.path.join("."), issue.message] : undefined;
};

describe("sourceListRequestV2", () => {
  it("defaults the limit to 20 and leaves the cursor and search out", () => {
    // Act & Assert
    expect(sourceListRequestV2.parse({ sourceId: "skku-notice02" })).toEqual({ sourceId: "skku-notice02", limit: 20, cursor: null, q: undefined });
  });

  it.each([
    ["0", 1],
    ["51", 50],
    ["12abc", 12],
    ["abc", 20],
  ])("reads limit %j as %j", (raw, limit) => {
    // Act & Assert
    expect(sourceListRequestV2.parse({ sourceId: "skku-notice02", limit: raw }).limit).toBe(limit);
  });

  it("decodes a cursor of the released list, trims the search text and drops a type", () => {
    // Arrange
    const cursor = { d: "2026-04-01", i: OID };

    // Act
    const parsed = sourceListRequestV2.parse({ sourceId: "skku-notice02", cursor: mint(cursor), q: "  장학  ", type: "bogus" });

    // Assert
    expect(parsed).toEqual({ sourceId: "skku-notice02", limit: 20, cursor, q: "장학" });
  });

  it("reports the source before the cursor, treats an empty cursor as none and drops an over-long search", () => {
    // Act & Assert
    expect(firstIssue(sourceListRequestV2.safeParse({ sourceId: "nope", cursor: "!!!" }))).toEqual(["sourceId", "unknown sourceId: nope"]);
    expect(firstIssue(sourceListRequestV2.safeParse({ sourceId: "skku-notice02", cursor: "!!!" }))).toEqual(["cursor", "cursor is malformed"]);
    expect(sourceListRequestV2.parse({ sourceId: "skku-notice02", cursor: "", q: "x".repeat(101) })).toMatchObject({ cursor: null, q: undefined });
  });
});

describe("multiListRequestV2", () => {
  it("reads the comma-joined sourceIds with the same limit, cursor and search", () => {
    // Act
    const parsed = multiListRequestV2.parse({ sourceIds: "skku-notice02, skku-notice06", limit: "5", q: "장학", type: "event" });

    // Assert
    expect(parsed).toEqual({ sourceIds: ["skku-notice02", "skku-notice06"], limit: 5, cursor: null, q: "장학" });
  });

  it.each([
    [undefined, "INVALID_PARAMS"],
    ["", "INVALID_PARAMS"],
    [["skku-notice02", "skku-notice06"], "INVALID_PARAMS"],
    ["skku-notice02,nope", "INVALID_SOURCE_ID"],
  ])("refuses sourceIds %j with %s", (sourceIds, code) => {
    // Act & Assert
    expect(() => multiListRequestV2.parse({ sourceIds })).toThrow(expect.objectContaining({ code }));
  });
});
