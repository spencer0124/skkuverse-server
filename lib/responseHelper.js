/**
 * Response helper middleware.
 * Attaches res.success(data, meta) and res.error(statusCode, code, message)
 * to every response. Auto-injects `lang` from req.lang into meta and sets
 * X-Response-Time header right before res.json().
 */
function responseHelper(req, res, next) {
  const start = process.hrtime.bigint();

  res.success = (data, meta = {}) => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
    res.json({ meta: { lang: req.lang, ...meta }, data });
  };

  res.error = (statusCode, code, message) => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
    res.status(statusCode).json({ error: { code, message } });
  };

  next();
}

module.exports = responseHelper;
