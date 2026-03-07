/**
 * Language middleware.
 * Parses Accept-Language header and sets req.lang to the best match
 * from supported languages. Defaults to 'ko' (primary user base).
 */
const SUPPORTED = ["ko", "en", "zh"];

function langMiddleware(req, res, next) {
  const header = req.headers["accept-language"] || "ko";
  const lang = header.split(",")[0].split("-")[0].toLowerCase();
  req.lang = SUPPORTED.includes(lang) ? lang : "ko";
  res.set("Vary", "Accept-Language");
  next();
}

module.exports = langMiddleware;
