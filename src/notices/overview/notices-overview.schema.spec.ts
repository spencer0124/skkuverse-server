/**
 * The route's query: sources first, then q, each refused as a 400 before the answer.
 */
import { overviewRequest } from "./notices-overview.schema";

describe("overviewRequest", () => {
  it("passes a captured query, trimming q", () => {
    // Act & Assert
    expect(overviewRequest.parse({ sourceIds: "skku-main,skku-notice02", q: " 장학금 " })).toEqual({ sourceIds: ["skku-main", "skku-notice02"], q: "장학금" });
  });

  it.each([
    ["missing q", { sourceIds: "skku-main" }],
    ["blank q", { sourceIds: "skku-main", q: "   " }],
    ["q over 100 codepoints", { sourceIds: "skku-main", q: "가".repeat(101) }],
    ["a repeated q", { sourceIds: "skku-main", q: ["a", "b"] }],
  ])("fails %s with the q message", (_label, query) => {
    // Act & Assert
    expect(overviewRequest.safeParse(query).error?.issues[0]?.message).toBe("q: 1-100 characters required");
  });

  it.each([
    ["missing sourceIds", { q: "장학금" }, "INVALID_PARAMS"],
    ["a repeated sourceIds", { q: "장학금", sourceIds: ["skku-main", "skku-main"] }, "INVALID_PARAMS"],
    ["21 sourceIds", { q: "장학금", sourceIds: Array(21).fill("skku-main").join(",") }, "INVALID_PARAMS"],
    ["an unknown source", { q: "장학금", sourceIds: "nope" }, "INVALID_SOURCE_ID"],
    ["an unknown source before a bad q", { q: "", sourceIds: "nope" }, "INVALID_SOURCE_ID"],
  ])("throws %s as a 400 with its code", (_label, query, code) => {
    // Act & Assert
    expect(() => overviewRequest.safeParse(query)).toThrow(expect.objectContaining({ code, httpStatus: 400 }));
  });
});
