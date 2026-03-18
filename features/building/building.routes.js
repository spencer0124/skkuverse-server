const { Router } = require("express");
const asyncHandler = require("../../lib/asyncHandler");
const {
  getAllBuildings,
  getBuildingBySkkuId,
  getFloorsByBuildNo,
  getConnectionsForBuilding,
  searchBuildings,
  searchSpaces,
  toDisplayNo,
} = require("./building.data");

const router = Router();

// GET /building/list?campus=hssc
router.get(
  "/list",
  asyncHandler(async (req, res) => {
    const campus = req.query.campus || null;
    if (campus && campus !== "hssc" && campus !== "nsc") {
      return res.error(400, "INVALID_CAMPUS", "campus must be 'hssc' or 'nsc'");
    }

    const buildings = await getAllBuildings(campus);
    res.success({ buildings });
  }),
);

// GET /building/search?q=도서&campus=nsc
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = (req.query.q || "").trim();
    if (!q) {
      return res.error(400, "MISSING_QUERY", "q parameter is required");
    }

    const campus = req.query.campus || null;
    if (campus && campus !== "hssc" && campus !== "nsc") {
      return res.error(400, "INVALID_CAMPUS", "campus must be 'hssc' or 'nsc'");
    }

    const [buildings, spaces, allBuildings] = await Promise.all([
      searchBuildings(q, campus),
      searchSpaces(q, campus),
      getAllBuildings(),
    ]);

    // buildNo → skkuId lookup (from cached buildings)
    const buildNoToSkkuId = new Map(
      allBuildings.filter((b) => b.buildNo).map((b) => [b.buildNo, b._id]),
    );

    // Group spaces by buildNo
    const spaceGroups = [];
    const groupMap = new Map();
    for (const s of spaces) {
      if (!groupMap.has(s.buildNo)) {
        const group = {
          skkuId: buildNoToSkkuId.get(s.buildNo) || null,
          buildNo: s.buildNo,
          displayNo: toDisplayNo(s.buildNo, s.campus),
          buildingName: s.buildingName,
          items: [],
        };
        groupMap.set(s.buildNo, group);
        spaceGroups.push(group);
      }
      groupMap.get(s.buildNo).items.push({
        spaceCd: s.spaceCd,
        name: s.name,
        floor: s.floor,
      });
    }

    res.success(
      { buildings, spaces: spaceGroups },
      { keyword: q, buildingCount: buildings.length, spaceCount: spaces.length },
    );
  }),
);

// GET /building/:skkuId
router.get(
  "/:skkuId",
  asyncHandler(async (req, res) => {
    const skkuId = parseInt(req.params.skkuId, 10);
    if (Number.isNaN(skkuId) || skkuId < 1) {
      return res.error(400, "INVALID_ID", "skkuId must be a positive integer");
    }

    const building = await getBuildingBySkkuId(skkuId);
    if (!building) {
      return res.error(404, "NOT_FOUND", `Building ${skkuId} not found`);
    }

    const [floors, connections] = await Promise.all([
      getFloorsByBuildNo(building.buildNo),
      getConnectionsForBuilding(skkuId),
    ]);

    res.success({ building, floors, connections });
  }),
);

module.exports = router;
