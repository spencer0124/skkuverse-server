const swaggerAutogen = require("swagger-autogen")({ openapi: "3.0.0" });

const options = {
  info: {
    title: "SKKU Map API",
    description: "성균관대학교 캠퍼스맵 API 문서",
  },
  servers: [
    {
      url: "http://localhost:3000",
    },
  ],
  schemes: ["http"],
};

const outputFile = "./swagger/swagger-output.json";
const endpointsFiles = ["./index.js"];

swaggerAutogen(outputFile, endpointsFiles, options);
