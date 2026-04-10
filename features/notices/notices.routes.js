const express = require("express");
const router = express.Router();
const asyncHandler = require("../../lib/asyncHandler");
const {
  findNoticesByDept,
  findNoticeByArticleNo,
} = require("./notices.data");
const {
  toListItem,
  toDetailItem,
  VALID_SUMMARY_TYPES,
} = require("./notices.transform");
const { decodeCursor, InvalidCursorError } = require("./notices.cursor");
const departments = require("./departments");

// Route order matters: `/departments` and `/dept/:deptId` must appear BEFORE
// the catch-all `/:deptId/:articleNo`, otherwise the dynamic pattern shadows
// them.

// GET /notices/departments
router.get(
  "/departments",
  asyncHandler(async (req, res) => {
    const etag = `W/"${departments.version.slice(0, 16)}"`;
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=3600"
    );
    res.setHeader("ETag", etag);
    // Express's `req.fresh` reads the response's ETag + Last-Modified headers
    // and compares them against If-None-Match / If-Modified-Since. It handles
    // weak/strong and comma-delimited lists for us. Must be called AFTER
    // setHeader("ETag", …) so the comparison sees our tag.
    if (req.fresh) return res.status(304).end();
    res.success(
      {
        departments: departments.list,
        version: departments.version,
      },
      { count: departments.list.length }
    );
  })
);

// GET /notices/dept/:deptId
router.get(
  "/dept/:deptId",
  asyncHandler(async (req, res) => {
    const { deptId } = req.params;
    if (!departments.map.has(deptId)) {
      return res.error(
        400,
        "INVALID_DEPT_ID",
        `unknown deptId: ${deptId}`
      );
    }

    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1),
      50
    );

    const type = req.query.type;
    if (type && !VALID_SUMMARY_TYPES.has(type)) {
      return res.error(
        400,
        "INVALID_PARAMS",
        "type must be one of: action_required, event, informational"
      );
    }

    let cursor = null;
    if (req.query.cursor) {
      try {
        cursor = decodeCursor(req.query.cursor);
      } catch (err) {
        if (err instanceof InvalidCursorError) {
          return res.error(400, "INVALID_CURSOR", "cursor is malformed");
        }
        throw err;
      }
    }

    const { items, nextCursor, hasMore } = await findNoticesByDept(deptId, {
      cursor,
      limit,
      type,
    });
    const notices = items.map(toListItem);
    res.success(
      { notices, nextCursor, hasMore },
      { count: notices.length }
    );
  })
);

// GET /notices/:deptId/:articleNo
router.get(
  "/:deptId/:articleNo",
  asyncHandler(async (req, res) => {
    const { deptId, articleNo } = req.params;
    if (!departments.map.has(deptId)) {
      return res.error(
        400,
        "INVALID_DEPT_ID",
        `unknown deptId: ${deptId}`
      );
    }
    if (!/^\d+$/.test(articleNo)) {
      return res.error(400, "INVALID_PARAMS", "articleNo must be numeric");
    }
    const doc = await findNoticeByArticleNo(deptId, Number(articleNo));
    if (!doc) {
      return res.error(404, "NOT_FOUND", "notice not found");
    }
    res.success(toDetailItem(doc));
  })
);

module.exports = router;
