import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";
import { toDisplayNo } from "./building.data";
import {
  BUILDING_SEARCH_LIMIT,
  SPACE_SEARCH_LIMIT,
} from "./building.search";
import type {
  BuildingDoc,
  Campus,
  SpaceDoc,
} from "./types";
import { AppError } from "../common/app-error";
import { sendSuccess } from "../common/send-success";
import { BuildingService } from "./building.service";

interface BilingualText {
  ko?: string;
  en?: string;
}

/** Add campusLabel to a building document. (Port of building.routes.ts:25-34.) */
function withCampusLabel<T extends { campus: Campus }>(
  building: T,
  lang: SupportedLang,
): T & { campusLabel: string } {
  return {
    ...building,
    campusLabel: t(`map.campus.${building.campus}.label`, lang),
  };
}

/** Fill empty .en with .ko for bilingual fields. (Port of building.routes.ts:36-39.) */
function fillEnFallback(obj: BilingualText | undefined): void {
  if (obj && !obj.en && obj.ko) obj.en = obj.ko;
}

// langMiddleware runs before this controller (mounted globally in main.ts), so
// req.lang is guaranteed at runtime; `as SupportedLang` mirrors the route file's
// `reqLang` cast (the original .js passed req.lang straight to t()).
function reqLang(req: Request): SupportedLang {
  return req.lang as SupportedLang;
}

/**
 * Port of the /building routes (mounted at /building, no auth,
 * generalLimiter). All three endpoints use @Res() + sendSuccess so the success
 * envelope — including /search's extra meta (keyword/buildingCount/spaceCount/
 * counts) — is byte-identical to res.success(data, meta). Validation throws
 * AppError(code, message, status) instead of res.error, preserving exact
 * status/code/message. The withCampusLabel / fillEnFallback / displayNo grouping
 * logic is reproduced verbatim from the route file.
 */
@Controller("building")
export class BuildingController {
  constructor(private readonly building: BuildingService) {}

  // GET /building/list?campus=hssc
  @Get("list")
  async list(
    @Query("campus") campusQuery: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const campusParam = campusQuery || null;
    if (campusParam && campusParam !== "hssc" && campusParam !== "nsc") {
      throw new AppError(
        "INVALID_CAMPUS",
        "campus must be 'hssc' or 'nsc'",
        400,
      );
    }
    const campus = campusParam as Campus | null;

    const buildings = await this.building.getAllBuildings(campus);
    const lang = reqLang(req);
    sendSuccess(req, res, {
      buildings: buildings.map((b) => withCampusLabel(b, lang)),
    });
  }

  // GET /building/search?q=도서&campus=nsc
  @Get("search")
  async search(
    @Query("q") qQuery: string | undefined,
    @Query("campus") campusQuery: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const q = (qQuery || "").trim();
    if (!q) {
      throw new AppError("MISSING_QUERY", "q parameter is required", 400);
    }

    const campusParam = campusQuery || null;
    if (campusParam && campusParam !== "hssc" && campusParam !== "nsc") {
      throw new AppError(
        "INVALID_CAMPUS",
        "campus must be 'hssc' or 'nsc'",
        400,
      );
    }
    const campus = campusParam as Campus | null;

    // Rows and counts now arrive together (one $facet per collection), so the
    // five-way fan-out collapsed to three and the count can no longer describe a
    // different predicate than the list.
    const [buildingResult, spaceResult, allBuildings] = await Promise.all([
      this.building.searchBuildings(q, campus),
      this.building.searchSpaces(q, campus),
      this.building.getAllBuildings(),
    ]);
    const buildings = buildingResult.items;
    const spaces = spaceResult.items;
    const buildingCounts = buildingResult.counts;
    const spaceCounts = spaceResult.counts;

    const lang = reqLang(req);

    // buildNo → skkuId lookup (from cached buildings)
    const buildNoToSkkuId = new Map<string, number>(
      allBuildings
        .filter((b): b is BuildingDoc & { buildNo: string } => !!b.buildNo)
        .map((b) => [b.buildNo, b._id]),
    );

    // Fill empty English with Korean fallback (mutates each space).
    for (const s of spaces) {
      fillEnFallback(s.name);
      fillEnFallback(s.buildingName);
      fillEnFallback(s.floor);
    }

    interface SpaceGroupItem {
      spaceCd: string;
      name: SpaceDoc["name"];
      floor: SpaceDoc["floor"];
    }
    interface SpaceGroup {
      skkuId: number | null;
      buildNo: string;
      displayNo: string | null;
      campus: Campus;
      campusLabel: string;
      buildingName: SpaceDoc["buildingName"];
      items: SpaceGroupItem[];
    }
    const spaceGroups: SpaceGroup[] = [];
    const groupMap = new Map<string, SpaceGroup>();
    for (const s of spaces) {
      if (!groupMap.has(s.buildNo)) {
        const group: SpaceGroup = {
          skkuId: buildNoToSkkuId.get(s.buildNo) || null,
          buildNo: s.buildNo,
          displayNo: toDisplayNo(s.buildNo, s.campus),
          campus: s.campus,
          campusLabel: t(`map.campus.${s.campus}.label`, lang),
          buildingName: s.buildingName,
          items: [],
        };
        groupMap.set(s.buildNo, group);
        spaceGroups.push(group);
      }
      groupMap.get(s.buildNo)!.items.push({
        spaceCd: s.spaceCd,
        name: s.name,
        floor: s.floor,
      });
    }

    const buildingsWithLabel = buildings.map((b) => withCampusLabel(b, lang));

    sendSuccess(
      req,
      res,
      { buildings: buildingsWithLabel, spaces: spaceGroups },
      {
        keyword: q,
        buildingCount: buildings.length,
        spaceCount: spaces.length,
        counts: {
          building: buildingCounts,
          space: spaceCounts,
        },
        // Additive — the app's parseBuildingSearchResult reads only known keys,
        // so this ships without a client change. The row caps sit above any
        // realistic query (the largest building has 801 rooms), which is what
        // makes spaceCount and counts.space.total agree; `truncated` is here so
        // that on a pathological one-character query the cut is recorded rather
        // than silently presented as the whole result.
        limits: {
          building: {
            limit: BUILDING_SEARCH_LIMIT,
            total: buildingResult.total,
            truncated: buildingResult.truncated,
          },
          space: {
            limit: SPACE_SEARCH_LIMIT,
            total: spaceResult.total,
            truncated: spaceResult.truncated,
          },
        },
      },
    );
  }

  // GET /building/:skkuId
  @Get(":skkuId")
  async detail(
    @Param("skkuId") skkuIdParam: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const skkuId = parseInt(skkuIdParam, 10);
    if (Number.isNaN(skkuId) || skkuId < 1) {
      throw new AppError("INVALID_ID", "skkuId must be a positive integer", 400);
    }

    const building = await this.building.getBuildingBySkkuId(skkuId);
    if (!building) {
      throw new AppError("NOT_FOUND", `Building ${skkuId} not found`, 404);
    }

    const [floors, connections] = await Promise.all([
      this.building.getFloorsByBuildNo(building.buildNo),
      this.building.getConnectionsForBuilding(skkuId),
    ]);

    // Fill empty English with Korean fallback in floor spaces
    for (const f of floors) {
      fillEnFallback(f.floor);
      for (const s of f.spaces) {
        fillEnFallback(s.name);
      }
    }

    sendSuccess(req, res, {
      building: withCampusLabel(building, reqLang(req)),
      floors,
      connections,
    });
  }
}
