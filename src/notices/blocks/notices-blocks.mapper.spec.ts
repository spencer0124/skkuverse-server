/**
 * The audience the detail serves: each value once, in stored order, whatever number of quotes stored it, and no
 * quote. The brief and the refs need no mapping: their schemas already parse to the shape they are served in.
 */
import { toAudience } from "./notices-blocks.mapper";

describe("toAudience", () => {
  it("serves each value once, in stored order, whatever number of quotes stored it", () => {
    // Arrange
    const stored = {
      level: { include: [{ value: "grad" as const }, { value: "undergrad" as const }, { value: "grad" as const }] },
      status: { include: [{ value: "leave" as const }, { value: "enrolled" as const }, { value: "leave" as const }], exclude: [{ value: "alumni" as const }, { value: "alumni" as const }] },
      version: "audience-1",
    };

    // Act & Assert
    expect(toAudience(stored)).toEqual({ level: { include: ["grad", "undergrad"] }, status: { include: ["leave", "enrolled"], exclude: ["alumni"] }, version: "audience-1" });
  });

  it("serves empty lists as they are stored", () => {
    // Arrange
    const stored = { level: { include: [] }, status: { include: [], exclude: [] }, version: "audience-1" };

    // Act & Assert
    expect(toAudience(stored)).toEqual({ level: { include: [] }, status: { include: [], exclude: [] }, version: "audience-1" });
  });
});
