jest.useFakeTimers();

const request = require("supertest");
const app = require("../index");

afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
});

describe("GET /mobile/v1/mainpage/buslist", () => {
  it("returns busList with correct metaData count", async () => {
    const res = await request(app).get("/mobile/v1/mainpage/buslist");
    expect(res.status).toBe(200);
    expect(res.body.metaData.busList_count).toBe(4);
    expect(res.body.busList).toHaveLength(4);
  });

  it("each busList item has required fields", async () => {
    const res = await request(app).get("/mobile/v1/mainpage/buslist");
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
    res.body.busList.forEach((item) => {
      requiredFields.forEach((field) => {
        expect(item).toHaveProperty(field);
      });
    });
  });
});

describe("GET /mobile/v1/mainpage/scrollcomponent", () => {
  it("returns scrollcomponent with correct metaData count", async () => {
    const res = await request(app).get("/mobile/v1/mainpage/scrollcomponent");
    expect(res.status).toBe(200);
    expect(res.body.metaData.item_count).toBe(3);
    expect(res.body.itemList).toHaveLength(3);
  });

  it("each item has required fields", async () => {
    const res = await request(app).get("/mobile/v1/mainpage/scrollcomponent");
    res.body.itemList.forEach((item) => {
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("pageLink");
      expect(item).toHaveProperty("useAltPageLink");
    });
  });
});

describe("GET /ad/v1/addetail", () => {
  it("returns ad detail with required fields", async () => {
    const res = await request(app).get("/ad/v1/addetail");
    expect(res.status).toBe(200);
    const requiredFields = [
      "image",
      "image2",
      "link",
      "showtext",
      "text",
      "showtext2",
      "text2",
    ];
    requiredFields.forEach((field) => {
      expect(res.body).toHaveProperty(field);
    });
  });

  it("showtext is boolean", async () => {
    const res = await request(app).get("/ad/v1/addetail");
    expect(typeof res.body.showtext).toBe("boolean");
    expect(typeof res.body.showtext2).toBe("boolean");
  });
});
