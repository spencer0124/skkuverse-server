import type { Request, Response, NextFunction, RequestHandler } from "express";

type Handler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

const asyncHandler =
  (fn: Handler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export = asyncHandler;
