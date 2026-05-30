/**
 * Nest port of the /ui home-endpoint assertions from
 * __tests__/static-endpoints.test.ts — integration over UiController
 * (@Res() + sendSuccess). UiService delegates to the real pure features/ui/*
 * functions, so the SDUI payload bytes, i18n text, and meta counts are identical
 * to the Express routes.
 *
 * No DB/axios is touched (UiModule reads only static config + i18n). Asserts the
 * dynamic meta.busListCount / meta.itemCount, item shapes, lang defaulting, the
 * English i18n switch, and the /home/campus section structure.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { buildUiApp } from "../../helpers/nest/build-ui-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildUiApp();
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /ui/home/transitlist", () => {
  it("returns busList with dynamic meta count", async () => {
    const res = await request(httpServer).get("/ui/home/transitlist");
    expect(res.status).toBe(200);
    expect(res.body.meta.busListCount).toBeGreaterThanOrEqual(4);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data.length).toBe(res.body.meta.busListCount);
  });

  it("each busList item has groupId, card, and action", async () => {
    const res = await request(httpServer).get("/ui/home/transitlist");
    for (const item of res.body.data) {
      expect(item).toHaveProperty("groupId");
      expect(item).toHaveProperty("card");
      expect(item.card).toHaveProperty("label");
      expect(item.card).toHaveProperty("themeColor");
      expect(item.card).toHaveProperty("iconType");
      expect(item.card).toHaveProperty("busTypeText");
      expect(item).toHaveProperty("action");
      expect(item.action).toHaveProperty("route");
      expect(item.action).toHaveProperty("groupId");
      expect(["/bus/realtime", "/bus/schedule"]).toContain(item.action.route);
    }
  });

  it("returns English text with Accept-Language: en", async () => {
    const res = await request(httpServer)
      .get("/ui/home/transitlist")
      .set("Accept-Language", "en");
    expect(res.body.meta.lang).toBe("en");
    expect(res.body.data[0].card.label).toBe("HSSC Shuttle Bus");
  });
});

describe("GET /ui/home/scroll", () => {
  it("returns scroll items with correct meta count", async () => {
    const res = await request(httpServer).get("/ui/home/scroll");
    expect(res.status).toBe(200);
    expect(res.body.meta.itemCount).toBe(3);
    expect(res.body.data).toHaveLength(3);
  });

  it("each item has required fields", async () => {
    const res = await request(httpServer).get("/ui/home/scroll");
    for (const item of res.body.data) {
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("pageLink");
      expect(item).toHaveProperty("useAltPageLink");
    }
  });
});

describe("GET /ui/home/campus", () => {
  it("returns minAppVersion and a button_grid section", async () => {
    const res = await request(httpServer).get("/ui/home/campus");
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data).toHaveProperty("minAppVersion", "2.0.0");
    expect(Array.isArray(res.body.data.sections)).toBe(true);
    expect(res.body.data.sections).toHaveLength(1);
    const section = res.body.data.sections[0];
    expect(section).toHaveProperty("type", "button_grid");
    expect(section).toHaveProperty("columns", 4);
    expect(Array.isArray(section.items)).toBe(true);
    expect(section.items).toHaveLength(4);
    for (const item of section.items) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("actionType");
      expect(item).toHaveProperty("actionValue");
    }
  });
});
