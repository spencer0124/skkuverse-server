import { Router } from "express";
import asyncHandler from "../../lib/asyncHandler";
import { option1 } from "./search.building";
import { option1_detail } from "./search.building-detail";
import { option3 } from "./search.space";

const router = Router();

router.get(
  "/buildings/:query",
  asyncHandler(async (req, res) => {
    const query = (req.params.query as string).trim();
    if (!query || query.length > 100) {
      return res.error(400, "INVALID_QUERY", "Query must be 1-100 characters");
    }

    const option1Hssc = await option1(query, 1);
    const option1Nsc = await option1(query, 2);

    const buildingsHsscCount = option1Hssc.length;
    const buildingsNscCount = option1Nsc.length;
    const buildingsTotalCount = option1Hssc.length + option1Nsc.length;

    const option3Hssc = await option3(query, 1);
    const option3Nsc = await option3(query, 2);

    const facilitiesHsscCount = option3Hssc.length;
    const facilitiesNscCount = option3Nsc.length;
    const facilitiesTotalCount = option3Hssc.length + option3Nsc.length;

    const totalHsscCount = buildingsHsscCount + facilitiesHsscCount;
    const totalNscCount = buildingsNscCount + facilitiesNscCount;
    const totalCount = totalHsscCount + totalNscCount;

    res.success(
      {
        buildings: { hssc: option1Hssc, nsc: option1Nsc },
        facilities: { hssc: option3Hssc, nsc: option3Nsc },
      },
      {
        keyword: query,
        totalCount,
        totalHsscCount,
        totalNscCount,
        buildingsTotalCount,
        buildingsHsscCount,
        buildingsNscCount,
        facilitiesTotalCount,
        facilitiesHsscCount,
        facilitiesNscCount,
      },
    );
  }),
);

router.get(
  "/detail/:buildNo/:id",
  asyncHandler(async (req, res) => {
    const { buildNo, id } = req.params as { buildNo: string; id: string };
    if (!buildNo || !id) {
      return res.error(400, "INVALID_PARAMS", "buildNo and id are required");
    }

    const mergedResults = await option1_detail(buildNo, id);
    res.success(mergedResults);
  }),
);

router.get(
  "/facilities/:query",
  asyncHandler(async (req, res) => {
    const query = (req.params.query as string).trim();
    if (!query || query.length > 100) {
      return res.error(400, "INVALID_QUERY", "Query must be 1-100 characters");
    }

    const facilitiesHssc = await option3(query, 1);
    const facilitiesNsc = await option3(query, 2);
    const facilitiesHsscCount = facilitiesHssc.length;
    const facilitiesNscCount = facilitiesNsc.length;
    const facilitiesTotalCount = facilitiesHssc.length + facilitiesNsc.length;

    res.success(
      { hssc: facilitiesHssc, nsc: facilitiesNsc },
      {
        keyword: query,
        facilitiesTotalCount,
        facilitiesHsscCount,
        facilitiesNscCount,
      },
    );
  }),
);

export = router;
