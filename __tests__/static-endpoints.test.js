jest.useFakeTimers();

// Mock ad modules before requiring the app
jest.mock("../features/ad/ad.data", () => ({
  getPlacements: jest.fn().mockResolvedValue({
    splash: {
      type: "image",
      imageUrl: "https://i.imgur.com/VEJpasQ.png",
      linkUrl: "http://pf.kakao.com/_cjxexdG",
      enabled: true,
      adId: "000000000000000000000001",
    },
    main_banner: {
      type: "text",
      text: "스꾸버스 카카오톡 채널 - 문의하기",
      linkUrl: "http://pf.kakao.com/_cjxexdG",
      enabled: true,
      adId: "000000000000000000000002",
    },
    main_notice: {
      type: "text",
      text: "인자셔틀 - 토/일/공휴일 운행없음",
      linkUrl: "https://forms.gle/3Zmytp6z15ww1KXXA",
      enabled: false,
      adId: "000000000000000000000003",
    },
    bus_bottom: {
      type: "image",
      imageUrl: "",
      linkUrl: "http://pf.kakao.com/_cjxexdG",
      enabled: false,
      adId: "000000000000000000000004",
    },
  }),
  ensureIndexes: jest.fn().mockResolvedValue(),
  seedIfEmpty: jest.fn().mockResolvedValue(),
  clearCache: jest.fn(),
  weightedRandomSelect: jest.fn(),
  getAdsCollection: jest.fn(),
  getEventsCollection: jest.fn(),
  FALLBACK_PLACEMENTS: {},
}));

jest.mock("../features/ad/ad.stats", () => ({
  recordEvent: jest.fn().mockResolvedValue(),
  getStats: jest.fn().mockResolvedValue({}),
}));

// Mock Firebase Admin SDK to avoid initialization
jest.mock("../lib/firebase", () => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: "test-uid" }),
  }),
}));

// Mock busCache to avoid real MongoDB connection
// cachedRead returns null → routes fall back to in-memory getters
jest.mock("../lib/busCache", () => ({
  ensureIndex: jest.fn().mockResolvedValue(),
  write: jest.fn().mockResolvedValue(),
  read: jest.fn().mockResolvedValue(null),
  cachedRead: jest.fn().mockResolvedValue(null),
}));

const request = require("supertest");
const app = require("../index");

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});

describe("GET /ui/home/buslist", () => {
  it("returns busList with correct meta count", async () => {
    const res = await request(app).get("/ui/home/buslist");
    expect(res.status).toBe(200);
    expect(res.body.meta.busListCount).toBe(4);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data).toHaveLength(4);
  });

  it("each busList item has required fields", async () => {
    const res = await request(app).get("/ui/home/buslist");
    const requiredFields = [
      "title",
      "subtitle",
      "busTypeText",
      "busTypeBgColor",
      "pageLink",
      "pageWebviewLink",
      "useAltPageLink",
      "showAnimation",
      "showNoticeText",
    ];
    res.body.data.forEach((item) => {
      requiredFields.forEach((field) => {
        expect(item).toHaveProperty(field);
      });
    });
  });

  it("returns English text with Accept-Language: en", async () => {
    const res = await request(app)
      .get("/ui/home/buslist")
      .set("Accept-Language", "en");
    expect(res.body.meta.lang).toBe("en");
    expect(res.body.data[0].title).toBe("HSSC Shuttle Bus");
  });
});

describe("GET /ui/home/scroll", () => {
  it("returns scroll items with correct meta count", async () => {
    const res = await request(app).get("/ui/home/scroll");
    expect(res.status).toBe(200);
    expect(res.body.meta.itemCount).toBe(3);
    expect(res.body.data).toHaveLength(3);
  });

  it("each item has required fields", async () => {
    const res = await request(app).get("/ui/home/scroll");
    res.body.data.forEach((item) => {
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("pageLink");
      expect(item).toHaveProperty("useAltPageLink");
    });
  });
});

describe("GET /ad/placements", () => {
  it("returns only enabled placements with meta count", async () => {
    const res = await request(app).get("/ad/placements");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("meta");
    expect(res.body.meta.count).toBe(2); // only splash + main_banner enabled
    expect(res.body).toHaveProperty("data");
  });

  it("each placement has required fields including adId", async () => {
    const res = await request(app).get("/ad/placements");
    const placements = res.body.data;
    Object.values(placements).forEach((p) => {
      expect(p).toHaveProperty("type");
      expect(p).toHaveProperty("linkUrl");
      expect(p).toHaveProperty("enabled", true);
      expect(p).toHaveProperty("adId");
    });
  });

  it("does not include disabled placements", async () => {
    const res = await request(app).get("/ad/placements");
    const keys = Object.keys(res.body.data);
    expect(keys).not.toContain("main_notice");
    expect(keys).not.toContain("bus_bottom");
  });
});

describe("POST /ad/events", () => {
  it("records a valid event with adId", async () => {
    const res = await request(app)
      .post("/ad/events")
      .send({ placement: "splash", event: "view" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      placement: "splash",
      event: "view",
      adId: "000000000000000000000001",
    });
  });

  it("accepts explicit adId from client", async () => {
    const res = await request(app)
      .post("/ad/events")
      .send({
        placement: "splash",
        event: "click",
        adId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.adId).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("rejects missing fields", async () => {
    const res = await request(app).post("/ad/events").send({});
    expect(res.status).toBe(400);
  });

  it("rejects unknown placement", async () => {
    const res = await request(app)
      .post("/ad/events")
      .send({ placement: "unknown", event: "view" });
    expect(res.status).toBe(400);
  });
});
