const { ipKeyGenerator } = require("express-rate-limit");

const byUidOrIp = (req) => req.uid || ipKeyGenerator(req.ip);
const byIp = (req) => ipKeyGenerator(req.ip);

module.exports = { byUidOrIp, byIp };
