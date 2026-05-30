import { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

const byUidOrIp = (req: Request): string =>
  req.uid || ipKeyGenerator(req.ip ?? "");
const byIp = (req: Request): string => ipKeyGenerator(req.ip ?? "");

export { byUidOrIp, byIp };
