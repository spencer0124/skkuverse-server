import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { RateLimitPolicy } from "../perimeter/perimeter.ports";

@Injectable()
export class NoticesOverviewRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RequestHandler;

  constructor(policy: RateLimitPolicy) {
    this.limiter = policy.handlerFor("notices-overview");
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
