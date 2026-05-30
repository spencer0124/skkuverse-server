import type { Request, Response } from "express";

/**
 * Byte-for-byte reproduction of lib/responseHelper.ts res.success(...):
 *   res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`)
 *   res.json({ meta: { lang: req.lang, ...meta }, data })
 *
 * `start` is read from req.__startNs (stashed by LangMiddleware at the front of
 * the chain), mirroring responseHelper capturing process.hrtime.bigint() at
 * request entry. Bus controllers that need ETag/304 control use @Res() and call
 * this directly so they replicate the envelope without going through the
 * global ResponseInterceptor.
 */
export function sendSuccess(
  req: Request,
  res: Response,
  data: unknown,
  meta: Record<string, unknown> = {},
): void {
  const start = req.__startNs ?? process.hrtime.bigint();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
  res.json({ meta: { lang: req.lang, ...meta }, data });
}
