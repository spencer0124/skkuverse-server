const express = require("express");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const { option1 } = require("./search.building");
const { option1_detail } = require("./search.building-detail");
const { option3 } = require("./search.space");

router.get("/all/:query", asyncHandler(async (req, res) => {
  const option1Hssc = await option1(req.params.query, 1);
  const option1Nsc = await option1(req.params.query, 2);

  const buildingsHsscCount = option1Hssc.length;
  const buildingsNscCount = option1Nsc.length;
  const buildingsTotalCount = option1Hssc.length + option1Nsc.length;

  const option3Hssc = await option3(req.params.query, 1);
  const option3Nsc = await option3(req.params.query, 2);

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
      keyword: req.params.query,
      totalCount,
      totalHsscCount,
      totalNscCount,
      buildingsTotalCount,
      buildingsHsscCount,
      buildingsNscCount,
      facilitiesTotalCount,
      facilitiesHsscCount,
      facilitiesNscCount,
    }
  );
}));

router.get("/detail/:buildNo/:id", asyncHandler(async (req, res) => {
  const mergedResults = await option1_detail(req.params.buildNo, req.params.id);
  res.success(mergedResults);
}));

router.get("/facilities/:query", asyncHandler(async (req, res) => {
  const facilitiesHssc = await option3(req.params.query, 1);
  const facilitiesNsc = await option3(req.params.query, 2);
  const facilitiesHsscCount = facilitiesHssc.length;
  const facilitiesNscCount = facilitiesNsc.length;
  const facilitiesTotalCount = facilitiesHssc.length + facilitiesNsc.length;

  res.success(
    { hssc: facilitiesHssc, nsc: facilitiesNsc },
    {
      keyword: req.params.query,
      facilitiesTotalCount,
      facilitiesHsscCount,
      facilitiesNscCount,
    }
  );
}));

module.exports = router;
