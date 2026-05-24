import type { Request, Response, NextFunction } from "express";

function responseHelper(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.success = (data, meta = {}) => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
    // req.lang is typed as optional (langMiddleware may not have run for routes
    // mounted before it, e.g. /api-docs). Fall back to "ko" so the response
    // envelope's lang field is always present — JSON.stringify drops undefined.
    res.json({ meta: { lang: req.lang ?? "ko", ...meta }, data });
  };

  res.error = (statusCode, code, message) => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
    res.status(statusCode).json({ error: { code, message } });
  };

  next();
}

export = responseHelper;
