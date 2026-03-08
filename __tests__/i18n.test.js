const { t } = require("../lib/i18n");

describe("i18n t()", () => {
  it("returns Korean by default", () => {
    expect(t("buslist.hssc.title", "ko")).toBe("인사캠 셔틀버스");
  });

  it("returns English translation", () => {
    expect(t("buslist.hssc.title", "en")).toBe("HSSC Shuttle Bus");
  });

  it("falls back to Korean for unsupported language", () => {
    expect(t("buslist.hssc.title", "xx")).toBe("인사캠 셔틀버스");
  });

  it("returns key string for unknown key", () => {
    expect(t("nonexistent.key", "ko")).toBe("nonexistent.key");
  });
});

describe("bus config group labels", () => {
  const groupKeys = [
    "busconfig.label.hssc",
    "busconfig.label.campus",
    "busconfig.label.jongro02",
    "busconfig.label.jongro07",
    "busconfig.label.fasttrack",
  ];

  it.each(groupKeys)("%s exists in ko, en, zh", (key) => {
    const ko = t(key, "ko");
    const en = t(key, "en");
    const zh = t(key, "zh");
    expect(ko).not.toBe(key);
    expect(en).not.toBe(key);
    expect(zh).not.toBe(key);
  });

  it("English labels differ from Korean", () => {
    expect(t("busconfig.label.hssc", "en")).not.toBe(t("busconfig.label.hssc", "ko"));
  });
});

describe("bus config service tab labels", () => {
  const serviceKeys = [
    "busconfig.service.campus-inja",
    "busconfig.service.campus-jain",
  ];

  it.each(serviceKeys)("%s exists in ko, en, zh", (key) => {
    const ko = t(key, "ko");
    const en = t(key, "en");
    const zh = t(key, "zh");
    expect(ko).not.toBe(key);
    expect(en).not.toBe(key);
    expect(zh).not.toBe(key);
  });
});

describe("bus config route badge labels", () => {
  const badgeKeys = [
    "busconfig.badge.regular",
    "busconfig.badge.hakbu",
    "busconfig.badge.fasttrack",
  ];

  it.each(badgeKeys)("%s exists in ko, en, zh", (key) => {
    const ko = t(key, "ko");
    const en = t(key, "en");
    const zh = t(key, "zh");
    expect(ko).not.toBe(key);
    expect(en).not.toBe(key);
    expect(zh).not.toBe(key);
  });
});
