require("dotenv").config();
const cron = require("node-cron");
const axios = require("axios");
const moment = require("moment-timezone");
const fs = require("fs");
const path = require("path");

const APIs = [
  { name: "hssc", url: process.env.API_HSSC_NEW_PROD },
  { name: "jongro07_list", url: process.env.API_JONGRO07_LIST_PROD },
  { name: "jongro02_list", url: process.env.API_JONGRO02_LIST_PROD },
  { name: "jongro07_loc", url: process.env.API_JONGRO07_LOC_PROD },
  { name: "jongro02_loc", url: process.env.API_JONGRO02_LOC_PROD },
  { name: "station_hyehwa", url: process.env.API_STATION_HEWA },
];

const FIXTURES_DIR = path.join(__dirname, "..", "__fixtures__");

async function collectAll() {
  const now = moment().tz("Asia/Seoul");
  const dateStr = now.format("YYYY-MM-DD");
  const timeStr = now.format("HHmm");
  const timestamp = now.format();

  const results = await Promise.allSettled(
    APIs.map((api) =>
      axios.get(api.url, { timeout: 15000 }).then((r) => ({ api, data: r.data }))
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
