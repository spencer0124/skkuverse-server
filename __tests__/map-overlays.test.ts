const { getOverlaysByCategory, computeEtag } = require("../features/map/map-overlays.data");

describe("getOverlaysByCategory()", () => {
  it("returns { category, overlays } for hssc", () => {
    const result = getOverlaysByCategory("hssc", "ko");
    expect(result).toMatchObject({
      category: "hssc",
      overlays: expect.any(Array),
    });
    expect(result.overlays.length).toBe(12);
  });

  it("returns { category, overlays } for nsc", () => {
    const result = getOverlaysByCategory("nsc", "ko");
    expect(result).toMatchObject({
      category: "nsc",
      overlays: expect.any(Array),
    });
    expect(result.overlays.length).toBe(1);
  });

  it("every overlay has discriminated union shape", () => {
    const { overlays } = getOverlaysByCategory("hssc", "ko");
    for (const overlay of overlays) {
      expect(overlay).toMatchObject({
        type: "marker",
        id: expect.stringMatching(/^bldg_hssc_/),
        position: {
          lat: expect.any(Number),
          lng: expect.any(Number),
        },
        marker: {
          icon: null,
          label: expect.any(String),
          subLabel: expect.any(String),
        },
      });
    }
  });

  it("localizes marker.label but not marker.subLabel", () => {
    const ko = getOverlaysByCategory("hssc", "ko");
    const en = getOverlaysByCategory("hssc", "en");

    // Labels differ between languages
    const koLabel = ko.overlays[0].marker.label;
    const enLabel = en.overlays[0].marker.label;
    expect(koLabel).not.toBe(enLabel);

    // subLabel (building number) stays the same
    const koSub = ko.overlays[0].marker.subLabel;
    const enSub = en.overlays[0].marker.subLabel;
    expect(koSub).toBe(enSub);
  });

  it("returns null for unknown category", () => {
    expect(getOverlaysByCategory("unknown", "ko")).toBeNull();
  });
});

describe("computeEtag()", () => {
  it("returns a quoted md5 string", () => {
    const etag = computeEtag("hssc", "ko");
    expect(etag).toMatch(/^"[a-f0-9]{32}"$/);
  });

  it("differs per language", () => {
    const ko = computeEtag("hssc", "ko");
    const en = computeEtag("hssc", "en");
    expect(ko).not.toBe(en);
  });

  it("returns null for unknown category", () => {
    expect(computeEtag("unknown", "ko")).toBeNull();
  });

  it("returns same value on repeated calls (cached)", () => {
    const first = computeEtag("hssc", "ko");
    const second = computeEtag("hssc", "ko");
    expect(first).toBe(second);
  });
});
