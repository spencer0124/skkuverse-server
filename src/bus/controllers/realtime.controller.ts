import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { HsscPollerService } from "../fetchers/hssc.poller.service";
import { JongroPollerService } from "../fetchers/jongro.poller.service";
import { BusCacheService } from "../cache/bus-cache.service";
import {
  JONGRO_ROUTES,
} from "../registry/jongro-registry.provider";
import type { JongroRoute } from "../registry/jongro-registry";
import {
  mapBuses,
  buildStationEtas,
  currentTimeString,
} from "../realtime/realtime.transforms";
import { AppError } from "../../common/app-error";
import { sendSuccess } from "../../common/send-success";

interface GroupConfigEntry {
  getBuses: () => Promise<unknown>;
  getStationEtas: (() => Promise<unknown[]>) | null;
}

/**
 * GET /bus/realtime/data/:groupId — port of features/bus/realtime.routes.ts.
 *
 * GROUP_CONFIG is built per-request from the injected poller getters + cache +
 * the validated JONGRO_ROUTES registry (so cache keys jongro_locations_<code> /
 * jongro_stations_<code> and station ordering are byte-identical). The
 * `?? getter()` cache-fallback pattern is preserved verbatim — NOT new
 * narrowing. mapBuses/buildStationEtas/currentTimeString are the verbatim
 * transforms (conditional latitude/longitude spread, parseInt-1).
 *
 * Cache-Control: no-store. meta extra: { currentTime, totalBuses }.
 */
@Controller("bus/realtime")
export class RealtimeController {
  constructor(
    private readonly hssc: HsscPollerService,
    private readonly jongro: JongroPollerService,
    private readonly cache: BusCacheService,
    @Inject(JONGRO_ROUTES)
    private readonly jongroRoutes: ReadonlyArray<JongroRoute>,
  ) {}

  private buildGroupConfig(): Record<string, GroupConfigEntry> {
    const jongroEntries: Record<string, GroupConfigEntry> = {};
    for (const route of this.jongroRoutes) {
      jongroEntries[route.id] = {
        getBuses: async () =>
          (await this.cache.cachedRead(`jongro_locations_${route.code}`)) ??
          this.jongro.getJongroBusLocation(route.code),
        getStationEtas: async () => {
          const busList =
            (await this.cache.cachedRead(`jongro_stations_${route.code}`)) ??
            this.jongro.getJongroBusList(route.code);
          return buildStationEtas(route.stations, busList);
        },
      };
    }

    return {
      hssc: {
        getBuses: async () =>
          (await this.cache.cachedRead("hssc")) ?? this.hssc.getHSSCBusList(),
        getStationEtas: null,
      },
      ...jongroEntries,
    };
  }

  @Get("data/:groupId")
  async getRealtime(
    @Param("groupId") groupId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!groupId) {
      throw new AppError("GROUP_NOT_FOUND", "Missing groupId", 404);
    }
    const cfg = this.buildGroupConfig()[groupId];
    if (!cfg) {
      throw new AppError(
        "GROUP_NOT_FOUND",
        `Unknown groupId: ${groupId}`,
        404,
      );
    }

    const rawBuses = await cfg.getBuses();
    const buses = mapBuses(rawBuses);
    const stationEtas = cfg.getStationEtas ? await cfg.getStationEtas() : [];

    res.set("Cache-Control", "no-store");
    sendSuccess(
      req,
      res,
      { groupId, buses, stationEtas },
      { currentTime: currentTimeString(), totalBuses: buses.length },
    );
  }
}
