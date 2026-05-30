import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { AppConfigService } from "./app-config.service";
import { validateEnv } from "./env.validation";

/**
 * @Global config module.
 *
 * - NestConfigModule.forRoot({ isGlobal, validate }) runs validateEnv() at
 *   bootstrap; the `validate` hook throws on any missing required env var
 *   (fail-loud, NestJS-native — does NOT process.exit).
 * - AppConfigService is the typed accessor (delegates to lib/config).
 * - APP_CONFIG_VALIDATION is a belt-and-suspenders provider whose useFactory
 *   also runs validateEnv() during DI graph construction, so the crash fires
 *   even if a future refactor changes how NestConfigModule's validate is wired.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true, // lib/config already loads dotenv; don't double-load
      validate: (cfg: Record<string, unknown>) => {
        validateEnv();
        return cfg;
      },
    }),
  ],
  providers: [
    AppConfigService,
    {
      provide: "APP_CONFIG_VALIDATION",
      useFactory: () => {
        validateEnv();
        return true;
      },
    },
  ],
  exports: [AppConfigService],
})
export class ConfigModule {}
