jest.mock("../lib/db", () => ({}));

const { floorSortKey } = require("../features/building/building.data");

describe("floorSortKey()", () => {
  it("sorts basement floors as negative numbers", () => {
    expect(floorSortKey("지하1층")).toBe(-1);
    expect(floorSortKey("지하4층")).toBe(-4);
  });

  it("sorts normal floors as positive numbers", () => {
    expect(floorSortKey("1층")).toBe(1);
    expect(floorSortKey("15층")).toBe(15);
  });

  it("sorts rooftop floors above all normal floors", () => {
    expect(floorSortKey("옥탑1층")).toBe(1001);
    expect(floorSortKey("옥탑2층")).toBe(1002);
  });

  it("puts unknown/null at the end", () => {
    expect(floorSortKey(null)).toBe(Infinity);
    expect(floorSortKey(undefined)).toBe(Infinity);
    expect(floorSortKey("기타")).toBe(Infinity);
  });

  it("produces correct full sort order", () => {
    const floors = ["3층", "1층", "옥탑1층", "지하2층", "15층", "지하1층", "2층"];
    const sorted = [...floors].sort((a, b) => floorSortKey(a) - floorSortKey(b));
    expect(sorted).toEqual([
      "지하2층", "지하1층", "1층", "2층", "3층", "15층", "옥탑1층",
    ]);
  });
});
