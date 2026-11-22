/**
 * ResponseInterceptor wraps a returned value in { meta: { lang, ...withMeta keys }, data } with
 * X-Response-Time, as sendSuccess() does for an @Res() handler, and leaves errors to the filter.
 * A response a shared cache may store (`public` or `s-maxage`) carries no `meta.lang`: Cloudflare
 * keys it without Accept-Language, so the lang would be another requester's (umbrella issue 63).
 * A returned StreamableFile is a file: it goes out as itself, with its own content type.
 */
import { Controller, Get, type INestApplication, Req, Res, StreamableFile } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import { AppError } from "./app.error";
import { CacheControl } from "./cache-control.decorator";
import { HttpExceptionFilter } from "./http-exception.filter";
import { ResponseInterceptor, sendSuccess, withMeta } from "./response.interceptor";

@Controller("t")
class EnvelopeController {
  @Get("plain")
  plain() {
    return { a: 1 };
  }

  @Get("meta")
  meta() {
    return withMeta({ a: 1 }, { keyword: "도서", counts: { total: 3 } });
  }

  @Get("raw")
  raw(@Req() req: Request, @Res() res: Response) {
    sendSuccess(req, res, withMeta({ a: 1 }, { keyword: "raw" }));
  }

  @Get("public")
  @CacheControl("public, max-age=60")
  shared() {
    return withMeta({ a: 1 }, { keyword: "public" });
  }

  @Get("private")
  @CacheControl("private, max-age=60")
  personal() {
    return { a: 1 };
  }

  @Get("s-maxage")
  sMaxAge(@Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "max-age=0, s-maxage=600");
    return { a: 1 };
  }

  @Get("file")
  file() {
    return new StreamableFile(Buffer.from("BEGIN:VCALENDAR\r\n"), { type: "text/calendar; charset=utf-8" });
  }

  @Get("error")
  error() {
    throw new AppError("INVALID_CAMPUS", "campus must be 'hssc' or 'nsc'", 400);
  }
}

describe("ResponseInterceptor", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EnvelopeController] }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: () => void) => {
      req.lang = "ko";
      next();
    });
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, "127.0.0.1");
  });

  afterAll(() => app.close());

  it("wraps a returned value in { meta: { lang }, data }", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/plain");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ meta: { lang: "ko" }, data: { a: 1 } });
    expect(res.headers["x-response-time"]).toMatch(/^\d+\.\dms$/);
  });

  it("adds withMeta() keys after lang, as sendSuccess() does", async () => {
    // Act
    const viaReturn = await request(app.getHttpServer()).get("/t/meta");

    // Assert
    expect(viaReturn.body).toEqual({
      meta: { lang: "ko", keyword: "도서", counts: { total: 3 } },
      data: { a: 1 },
    });
    expect(Object.keys(viaReturn.body.meta)).toEqual(["lang", "keyword", "counts"]);
    const viaRes = await request(app.getHttpServer()).get("/t/raw");
    expect(viaRes.body).toEqual({ meta: { lang: "ko", keyword: "raw" }, data: { a: 1 } });
  });

  it("leaves lang out of a response a shared cache may store, keeping withMeta() keys", async () => {
    // Act
    const declared = await request(app.getHttpServer()).get("/t/public");
    const setByHandler = await request(app.getHttpServer()).get("/t/s-maxage");

    // Assert
    expect(declared.headers["cache-control"]).toBe("public, max-age=60");
    expect(declared.body).toEqual({ meta: { keyword: "public" }, data: { a: 1 } });
    expect(setByHandler.body).toEqual({ meta: {}, data: { a: 1 } });
  });

  it("keeps lang on a private response", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/private");

    // Assert
    expect(res.headers["cache-control"]).toBe("private, max-age=60");
    expect(res.body).toEqual({ meta: { lang: "ko" }, data: { a: 1 } });
  });

  it("leaves errors to the filter", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/error");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_CAMPUS", message: "campus must be 'hssc' or 'nsc'" } });
  });

  it("sends a returned StreamableFile as itself, outside the envelope", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/t/file");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(res.text).toBe("BEGIN:VCALENDAR\r\n");
  });
});
