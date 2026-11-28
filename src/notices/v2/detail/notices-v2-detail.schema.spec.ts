/**
 * The v2 detail route's input: a source the committed sources.json holds and a numeric article number, read as a number.
 * The source is checked first, as on the released detail route.
 */
import { noticeDetailRequestV2 } from "./notices-v2-detail.schema";

describe("noticeDetailRequestV2", () => {
  it("reads a known source and a numeric article number", () => {
    // Act & Assert
    expect(noticeDetailRequestV2.parse({ sourceId: "skku-notice02", articleNo: "140482" })).toEqual({ sourceId: "skku-notice02", articleNo: 140482 });
  });

  it.each([
    [{ sourceId: "nope", articleNo: "1" }, "sourceId", "unknown sourceId: nope"],
    [{ sourceId: "skku-notice02", articleNo: "abc" }, "articleNo", "articleNo must be numeric"],
    [{ sourceId: "skku-notice02", articleNo: "1.5" }, "articleNo", "articleNo must be numeric"],
    [{ sourceId: "skku-notice02", articleNo: "-1" }, "articleNo", "articleNo must be numeric"],
  ])("refuses %j", (input, path, message) => {
    // Act
    const issue = noticeDetailRequestV2.safeParse(input).error?.issues[0];

    // Assert
    expect([issue?.path.join("."), issue?.message]).toEqual([path, message]);
  });
});
