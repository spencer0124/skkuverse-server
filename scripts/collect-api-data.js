require("dotenv").config();
const cron = require("node-cron");
const axios = require("axios");
const moment = require("moment-timezone");
const fs = require("fs");
const path = require("path");

// SKKU campusMap.do는 단일 endpoint에 mode/campusCd/buildNo/id로 분기하므로 params로 표현.
// 다른 bus API는 URL 그대로 GET. building_info는 buildList 응답에서 id를 알아야 호출 가능
// → 별도 헬퍼로 처리 (PR4b에서 buildList + spaceList만 정적 캡처, buildInfo는 동적).
const SKKU_CAMPUS_MAP =
  "https://www.skku.edu/skku/about/campusInfo/campusMap.do";

// Mirrors `features/bus/jongro.registry.ts` URL composition: single shared
// service key + per-route busRouteId from `jongro-routes.json`. Keep the
// fixture names as `${route.id}_list` / `_loc` so legacy paths
// `__fixtures__/<date>/jongro07_list/<time>.json` stay stable.
const SEOUL_BUS_BASE = "http://ws.bus.go.kr/api/rest";
const SEOUL_BUS_KEY = process.env.SEOUL_BUS_SERVICE_KEY;
const jongroRoutes = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "features", "bus", "jongro-routes.json"),
    "utf8",
  ),
);
const buildListUrl = (busRouteId) =>
  `${SEOUL_BUS_BASE}/arrive/getArrInfoByRouteAll?serviceKey=${SEOUL_BUS_KEY}&busRouteId=${busRouteId}&resultType=json`;
const buildLocUrl = (busRouteId, stationCount) =>
  `${SEOUL_BUS_BASE}/buspos/getBusPosByRouteSt?serviceKey=${SEOUL_BUS_KEY}&busRouteId=${busRouteId}&startOrd=1&endOrd=${stationCount}&resultType=json`;
const jongroApis = jongroRoutes.flatMap((r) => [
  { name: `${r.id}_list`, url: buildListUrl(r.busRouteId) },
  { name: `${r.id}_loc`, url: buildLocUrl(r.busRouteId, r.stations.length) },
]);

const APIs = [
  { name: "hssc", url: process.env.API_HSSC_NEW_PROD },
  ...jongroApis,
  { name: "station_hyehwa", url: process.env.API_STATION_HEWA },
  // --- SKKU building APIs (PR4b types.ts 검증용; 30-min cron으로 captured) ---
  {
    name: "building_list_hssc",
    url: SKKU_CAMPUS_MAP,
    params: { mode: "buildList", srSearchValue: "", campusCd: "1" },
  },
  {
    name: "building_list_nsc",
    url: SKKU_CAMPUS_MAP,
    params: { mode: "buildList", srSearchValue: "", campusCd: "2" },
  },
  {
    name: "building_space_list_hssc",
    url: SKKU_CAMPUS_MAP,
    params: { mode: "spaceList", srSearchValue: "", campusCd: "1" },
  },
  {
    name: "building_space_list_nsc",
    url: SKKU_CAMPUS_MAP,
    params: { mode: "spaceList", srSearchValue: "", campusCd: "2" },
  },
];

const FIXTURES_DIR = path.join(__dirname, "..", "__fixtures__");

async function collectAll() {
  const now = moment().tz("Asia/Seoul");
  const dateStr = now.format("YYYY-MM-DD");
  const timeStr = now.format("HHmm");
  const timestamp = now.format();

  const results = await Promise.allSettled(
    APIs.map((api) =>
      axios
        .get(api.url, { timeout: 15000, params: api.params })
        .then((r) => ({ api, data: r.data }))
    )
  );

  results.forEach((result, i) => {
    const dir = path.join(FIXTURES_DIR, dateStr, APIs[i].name);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${timeStr}.json`);

    if (result.status === "fulfilled") {
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            timestamp,
            api: APIs[i].name,
            status: "success",
            data: result.value.data,
          },
          null,
          2
        )
      );
    } else {
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            timestamp,
            api: APIs[i].name,
            status: "error",
            error: result.reason.message,
          },
          null,
          2
        )
      );
    }
  });

  const successCount = results.filter(
    (r) => r.status === "fulfilled"
  ).length;
  console.log(
    `[${timestamp}] Collected ${successCount}/${APIs.length} APIs (saved to __fixtures__/${dateStr}/*/${timeStr}.json)`
  );
}

// Validate env vars before starting
if (!SEOUL_BUS_KEY) {
  console.error(
    "Missing env variable: SEOUL_BUS_SERVICE_KEY (required for every jongro_* fixture). Check your .env file.",
  );
  process.exit(1);
}
const missing = APIs.filter((api) => !api.url).map((api) => api.name);
if (missing.length > 0) {
  console.error(
    `Missing env variables for: ${missing.join(", ")}\nCheck your .env file.`
  );
  process.exit(1);
}

// 시작 즉시 1회 실행 (00:00 데이터 누락 방지)
collectAll();

// 이후 매 :00, :30에 실행
cron.schedule("*/30 * * * *", collectAll, { timezone: "Asia/Seoul" });

console.log("Data collector started. Press Ctrl+C to stop.");
