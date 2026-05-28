import { Router } from "express";
import asyncHandler from "../../lib/asyncHandler";
import { t } from "../../lib/i18n";
import {
  countSearchBuildings,
  countSearchSpaces,
  getAllBuildings,
  getBuildingBySkkuId,
  getConnectionsForBuilding,
  getFloorsByBuildNo,
  searchBuildings,
  searchSpaces,
  toDisplayNo,
} from "./building.data";
import type { SupportedLang } from "../../lib/types";
import type { BuildingDoc, Campus, SpaceDoc } from "./types";

const router = Router();

interface BilingualText {
  ko?: string;
  en?: string;
}

/** Add campusLabel to a building document. */
function withCampusLabel<T extends { campus: Campus }>(
  building: T,
  lang: SupportedLang,
): T & { campusLabel: string } {
  return {
    ...building,
    campusLabel: t(`map.campus.${building.campus}.label`, lang),
  };
}

/** Fill empty .en with .ko for bilingual fields. */
function fillEnFallback(obj: BilingualText | undefined): void {
  if (obj && !obj.en && obj.ko) obj.en = obj.ko;
}

// langMiddleware는 이 라우터보다 먼저 mount되므로 req.lang은 런타임 보장됨
// (lib/types.ts:14-18의 optional 마킹은 /api-docs 등 일부 sub-tree만을 위한 것).
// `as SupportedLang` 단언은 type-system 보정 — 원본 .js는 req.lang을 그대로
// t()에 넘겼다.
function reqLang(req: { lang?: SupportedLang }): SupportedLang {
  return req.lang as SupportedLang;
}

// GET /building/list?campus=hssc
router.get(
  "/list",
  asyncHandler(async (req, res) => {
    const campusParam = (req.query.campus as string | undefined) || null;
    if (campusParam && campusParam !== "hssc" && campusParam !== "nsc") {
      return res.error(
        400,
        "INVALID_CAMPUS",
        "campus must be 'hssc' or 'nsc'",
      );
    }
    const campus = campusParam as Campus | null;

    const buildings = await getAllBuildings(campus);
    const lang = reqLang(req);
    res.success({
      buildings: buildings.map((b) => withCampusLabel(b, lang)),
    });
  }),
);

// GET /building/search?q=도서&campus=nsc
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = ((req.query.q as string | undefined) || "").trim();
    if (!q) {
      return res.error(400, "MISSING_QUERY", "q parameter is required");
    }

    const campusParam = (req.query.campus as string | undefined) || null;
    if (campusParam && campusParam !== "hssc" && campusParam !== "nsc") {
      return res.error(
        400,
        "INVALID_CAMPUS",
        "campus must be 'hssc' or 'nsc'",
      );
    }
    const campus = campusParam as Campus | null;

    const [buildings, spaces, allBuildings, buildingCounts, spaceCounts] =
      await Promise.all([
        searchBuildings(q, campus),
        searchSpaces(q, campus),
        getAllBuildings(),
        countSearchBuildings(q),
        countSearchSpaces(q),
      ]);

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

    res.success(
      { buildings: buildingsWithLabel, spaces: spaceGroups },
      {
        keyword: q,
        buildingCount: buildings.length,
        spaceCount: spaces.length,
        counts: {
          building: buildingCounts,
          space: spaceCounts,
        },
      },
    );
  }),
);

// GET /building/:skkuId
router.get(
  "/:skkuId",
  asyncHandler(async (req, res) => {
    const skkuId = parseInt(req.params.skkuId as string, 10);
    if (Number.isNaN(skkuId) || skkuId < 1) {
      return res.error(
        400,
        "INVALID_ID",
        "skkuId must be a positive integer",
      );
    }

    const building = await getBuildingBySkkuId(skkuId);
    if (!building) {
      return res.error(404, "NOT_FOUND", `Building ${skkuId} not found`);
    }

    const [floors, connections] = await Promise.all([
      getFloorsByBuildNo(building.buildNo),
      getConnectionsForBuilding(skkuId),
    ]);

    // Fill empty English with Korean fallback in floor spaces
    for (const f of floors) {
      fillEnFallback(f.floor);
      for (const s of f.spaces) {
        fillEnFallback(s.name);
      }
    }

    res.success({
      building: withCampusLabel(building, reqLang(req)),
      floors,
      connections,
    });
  }),
);

export = router;
