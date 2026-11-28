import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { NoticesRateLimitMiddleware } from "../../http/notices-rate-limit.middleware";
import { RequestAuthenticationMiddleware } from "../../http/request-authentication.middleware";

// WHY: the bindings of NoticesModule for the v2 prefix, in the same order: auth first, so the limiter may key on its principal.
// SEE: docs/explanation/notices-architecture.md
@Module({})
export class NoticesV2Module implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestAuthenticationMiddleware).forRoutes("v2/notices");
    consumer.apply(NoticesRateLimitMiddleware).forRoutes("v2/notices");
  }
}
