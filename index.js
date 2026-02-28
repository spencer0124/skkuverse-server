// nodemon index.js 명령어로 서버 실행

// Import the express module
const express = require("express");
const swaggerUi = require("swagger-ui-express");

let swaggerFile;
try {
  swaggerFile = require("./swagger/swagger-output.json");
} catch (e) {
  console.warn("swagger-output.json not found. Run 'npm run swagger' to generate it.");
}

// Create an instance of express
const app = express();

// Define a port number
const PORT = process.env.PORT || 3000;

// swagger api docs
if (swaggerFile) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile, { explorer: true }));
}

// Route
const searchRoute = require("./route/search/search.js");
const newhsscRoute = require("./route/bus/hssc_v1/hssc_new.js");
const jongroRoute = require("./route/bus/jongro/jongro.js");
const stationRoute = require("./route/station/station.js");
const mobileRoute = require("./route/mobile/mobile.js");
const adRoute = require("./route/ad/ad.js");
const pollRoute = require("./route/poll/poll.js");
const campusRoute = require("./route/bus/campus/campus.js");
app.use("/search", searchRoute);
app.use("/bus/hssc", newhsscRoute);
app.use("/bus/hssc_new", newhsscRoute);
app.use("/bus/jongro", jongroRoute);
app.use("/station", stationRoute);
app.use("/mobile/", mobileRoute);
app.use("/ad/", adRoute);
app.use("/poll/", pollRoute);
app.use("/campus/", campusRoute);

// Start the server on the specified port
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
