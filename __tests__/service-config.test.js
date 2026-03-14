const serviceConfig = require("../features/bus/service.config");

describe("service.config", () => {
  const knownIds = ["campus-inja", "campus-jain", "fasttrack-inja"];

  it("exports an object", () => {
    expect(typeof serviceConfig).toBe("object");
    expect(serviceConfig).not.toBeNull();
  });

  it.each(knownIds)("%s has nonOperatingDayDisplay", (id) => {
    expect(serviceConfig[id]).toBeDefined();
    expect(["noService", "hidden"]).toContain(
      serviceConfig[id].nonOperatingDayDisplay
    );
  });

  it.each(knownIds)("%s has notices array", (id) => {
    expect(Array.isArray(serviceConfig[id].notices)).toBe(true);
  });

  it("campus services use hidden display", () => {
    expect(serviceConfig["campus-inja"].nonOperatingDayDisplay).toBe("hidden");
    expect(serviceConfig["campus-jain"].nonOperatingDayDisplay).toBe("hidden");
  });

  it("fasttrack uses hidden display", () => {
    expect(serviceConfig["fasttrack-inja"].nonOperatingDayDisplay).toBe("hidden");
  });

  it("notice items have style and text fields", () => {
    for (const id of knownIds) {
      for (const notice of serviceConfig[id].notices) {
        expect(notice).toHaveProperty("style");
        expect(notice).toHaveProperty("text");
        expect(typeof notice.style).toBe("string");
        expect(typeof notice.text).toBe("string");
      }
    }
  });

  it.each(knownIds)("%s has suspend field (null or {from, until})", (id) => {
    const { suspend } = serviceConfig[id];
    if (suspend === null) {
      expect(suspend).toBeNull();
    } else {
      expect(suspend).toHaveProperty("from");
      expect(suspend).toHaveProperty("until");
      expect(suspend.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(suspend.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
