const swaggerAutogen = require("swagger-autogen")({ openapi: "3.0.0" });

const options = {
  info: {
    title: "SKKU Map API",
    description: "성균관대학교 캠퍼스맵 API 문서",
  },
  servers: [
    {
      url: process.env.SWAGGER_SERVER_URL || "http://localhost:3000",
    },
  ],
  schemes: ["http"],
};

const outputFile = "./swagger/swagger-output.json";
// dist/ output of tsc — index.js (and feature routes that .ts-import lib/)
// are emitted there. Run `npm run build` before `npm run swagger`.
const endpointsFiles = ["./dist/index.js"];

swaggerAutogen(outputFile, endpointsFiles, options);
