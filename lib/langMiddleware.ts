import type { Request, Response, NextFunction } from "express";
import type { SupportedLang } from "./types";

const SUPPORTED: readonly SupportedLang[] = ["ko", "en", "zh"];

function langMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["accept-language"] || "ko";
  const primary = header.split(",")[0] ?? "ko";
  const candidate = (primary.split("-")[0] ?? "ko").toLowerCase();
  req.lang = (SUPPORTED as readonly string[]).includes(candidate)
    ? (candidate as SupportedLang)
    : "ko";
  res.set("Vary", "Accept-Language");
  next();
}

export = langMiddleware;
