import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import config from "../infra/config";
import { SUPPORTED_LANGS, type SupportedLang } from "../infra/types";
import { AppError } from "../common/app-error";
import { sendSuccess } from "../common/send-success";
import { canonicalStringify, md5 } from "./eventmap.hash";
import { EventMapService } from "./eventmap.service";

/**
 * Public event map routes (skkuverse#14). Contract:
 * docs/reference/eventmap-api.md §7.
 *
 * Both handlers take @Res() and call sendSuccess directly rather than returning
 * a value through the global ResponseInterceptor, because both need ETag/304
 * control — the same mechanism as MapOverlaysController.
 *
 * Vary: Accept-Language is already set on every response by LangMiddleware
 * (mounted app-wide in main.ts), so there is nothing to add here.
 */

/**
 * Client freshness is DERIVED from the server memo TTL rather than written twice.
 * They describe the same 15 seconds — a client that revalidates sooner only ever
 * gets the memo back, and one that revalidates later is the staleness budget.
 */
const MANIFEST_MAX_AGE_SEC = Math.floor(config.eventmap.manifestCacheTtlMs / 1000);
const SNAPSHOT_MAX_AGE_SEC = 31536000;

const POSITIVE_INT_RE = /^[1-9][0-9]*$/;

@Controller("eventmap")
export class EventMapController {
  constructor(private readonly eventMap: EventMapService) {}

  // GET /eventmap/manifest
  @Get("manifest")
  async manifest(@Req() req: Request, @Res() res: Response): Promise<void> {
    const lang = (req.lang ?? "ko") as SupportedLang;
    const { manifest, degraded } = await this.eventMap.getManifest(lang);

    if (degraded) {
      // Same body as a genuine "nothing is running", but deliberately uncached.
      // A kill switch is a real answer worth 15 seconds of shared caching; a
      // momentary Mongo hiccup is not.
      //
      // No STRONG ETag is set here. Express still attaches its own weak
      // validator inside res.json(), and there is no clean per-route way to
      // suppress it — but it is harmless: no-store forbids storing the response,
      // and a client that revalidates regardless only gets a 304 while the
      // server is still degraded, which is the correct answer.
      res.set("Cache-Control", "no-store");
      sendSuccess(req, res, manifest);
      return;
    }

    // lang is hashed IN, not just the body. When nothing is active the manifest
    // is byte-identical across ko/en/zh (snapshotUrl is null), so hashing the
    // body alone would hand three different responses — they still differ in
    // meta.lang — one shared strong validator. Same defect class as the snapshot
    // route, bounded here by max-age=15 rather than a year, but free to avoid.
    const etag = `"${md5(canonicalStringify({ lang, manifest }))}"`;
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.set("ETag", etag);
    res.set("Cache-Control", `public, max-age=${MANIFEST_MAX_AGE_SEC}`);
    sendSuccess(req, res, manifest);
  }

  // GET /eventmap/snapshot/:layerSetId/:version?lang=ko
  @Get("snapshot/:layerSetId/:version")
  async snapshot(
    @Param("layerSetId") layerSetId: string,
    @Param("version") rawVersion: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Validation order is the repo rule: 400 → 404 → 304. An unknown layer set
    // with a stale If-None-Match must be a 404, not a 304 — a client holding a
    // reaped version needs to be told to go back to the manifest, and a 304
    // would tell it the opposite.
    if (!POSITIVE_INT_RE.test(rawVersion)) {
      throw new AppError("INVALID_PARAM", "version must be a positive integer", 400);
    }

    // lang is REQUIRED, with no Accept-Language fallback. This response is served
    // `immutable, max-age=1y`, which promises that this URL's representation will
    // not change; a header-derived fallback would make one URL return three
    // different bodies under that promise. Vary protects a conforming cache, but
    // a year is too long to bet on every intermediary and on the app's own HTTP
    // cache honouring it. The manifest always emits ?lang=, so nothing real breaks.
    const rawLang = req.query.lang;
    if (
      typeof rawLang !== "string" ||
      !(SUPPORTED_LANGS as readonly string[]).includes(rawLang)
    ) {
      throw new AppError(
        "INVALID_PARAM",
        `lang query parameter is required and must be one of [${SUPPORTED_LANGS.join(", ")}]`,
        400,
      );
    }
    const lang = rawLang as SupportedLang;
    const version = Number(rawVersion);

    const doc = await this.eventMap.getSnapshot(layerSetId, version);
    if (!doc) {
      throw new AppError(
        "SNAPSHOT_NOT_FOUND",
        `No snapshot for '${layerSetId}' version ${version}`,
        404,
      );
    }

    // One document holds all three languages, but each is a distinct RESOURCE
    // with its own bytes — so the validator is per language, not per document.
    const etag = doc.etags[lang];
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.set("ETag", etag);
    res.set("Cache-Control", `public, max-age=${SNAPSHOT_MAX_AGE_SEC}, immutable`);
    // The meta.lang OVERRIDE is load-bearing, not cosmetic. sendSuccess defaults
    // it to req.lang, which LangMiddleware derives from Accept-Language alone —
    // so without this the same URL returns meta.lang:"en" to one client and
    // meta.lang:"ko" to another, under one strong ETag and max-age=1y. That is
    // the exact hazard that made ?lang= mandatory above, and the envelope is an
    // easy place to reintroduce it. Here lang IS the resource identity.
    sendSuccess(req, res, doc.payloads[lang], { lang });
  }
}
