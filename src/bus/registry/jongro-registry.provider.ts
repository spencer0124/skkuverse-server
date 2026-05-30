import type { Provider } from "@nestjs/common";
import type { JongroRoute } from "./jongro-registry";

/**
 * DI token for the validated, frozen Jongro route registry.
 *
 * The useFactory references `jongroRoutes` inside the DI graph construction so
 * the fail-loud (service-key + jongro-routes.json validation in
 * features/bus/jongro.registry) surfaces at BOOTSTRAP, not lazily on first
 * import. Belt-and-suspenders empty/invalid check throws explicitly — NO
 * `?? []` silent fallback (per feedback_no_silent_defensive_narrowing).
 */
export const JONGRO_ROUTES = "JONGRO_ROUTES";

export const jongroRoutesProvider: Provider = {
  provide: JONGRO_ROUTES,
  useFactory: (): ReadonlyArray<JongroRoute> => {
    const { jongroRoutes } = require("./jongro-registry") as {
      jongroRoutes: ReadonlyArray<JongroRoute>;
    };
    if (!Array.isArray(jongroRoutes) || jongroRoutes.length === 0) {
      throw new Error("jongro registry empty/invalid");
    }
    return jongroRoutes;
  },
};
