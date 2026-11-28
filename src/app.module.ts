import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { PerimeterModule } from "./perimeter/perimeter.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { HealthModule } from "./health/health.module";
import { CalendarModule } from "./calendar/calendar.module";
import { BusModule } from "./bus/bus.module";
import { BusCacheModule } from "./bus/cache/bus-cache.module";
import { BusRegistryModule } from "./bus/registry/bus-registry.module";
import { BusRouteAttributesModule } from "./bus/route-attributes/bus-route-attributes.module";
import { BusRoutePathModule } from "./bus/route-path/bus-route-path.module";
import { BusHsscRouteLineModule } from "./bus/hssc-route-line/bus-hssc-route-line.module";
import { BusRealtimeModule } from "./bus/realtime/bus-realtime.module";
import { BusRealtimeHsscModule } from "./bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeJongroModule } from "./bus/realtime/jongro/bus-realtime-jongro.module";
import { BusRealtimeGbisModule } from "./bus/realtime/gbis/bus-realtime-gbis.module";
import { BusRealtimeArrivalModule } from "./bus/realtime/arrival/bus-realtime-arrival.module";
import { BusRealtimeGroupModule } from "./bus/realtime/group/bus-realtime-group.module";
import { BusRealtimeHsscEtaModule } from "./bus/realtime/hssc-eta/bus-realtime-hssc-eta.module";
import { BusStopsModule } from "./bus/stops/bus-stops.module";
import { BusScheduleContentModule } from "./bus/schedule-content/bus-schedule-content.module";
import { BusScheduleModule } from "./bus/schedule/bus-schedule.module";
import { BusEtaModule } from "./bus/eta/bus-eta.module";
import { BusEtaLaneModule } from "./bus/eta/lane/bus-eta-lane.module";
import { BusEtaProbeModule } from "./bus/eta/probe/bus-eta-probe.module";
import { BusEtaTravelModule } from "./bus/eta/travel/bus-eta-travel.module";
import { BusEtaForecastModule } from "./bus/eta/forecast/bus-eta-forecast.module";
import { BusEtaLiveModule } from "./bus/eta/live/bus-eta-live.module";
import { BusEtaBaselineModule } from "./bus/eta/baseline/bus-eta-baseline.module";
import { BusEtaSmartModule } from "./bus/eta/smart/bus-eta-smart.module";
import { BusConfigModule } from "./bus/config/bus-config.module";
import { BusLiveModule } from "./bus/live/bus-live.module";
import { BusLiveJongroModule } from "./bus/live/jongro/bus-live-jongro.module";
import { BusLiveHsscModule } from "./bus/live/hssc/bus-live-hssc.module";
import { BusLiveGroupModule } from "./bus/live/group/bus-live-group.module";
import { BusStopIndexModule } from "./bus/stop-index/bus-stop-index.module";
import { BusStopArrivalsModule } from "./bus/stop-arrivals/bus-stop-arrivals.module";
import { BusStopListModule } from "./bus/stop-list/bus-stop-list.module";
import { AppConfigModule } from "./app-config/app-config.module";
import { UiModule } from "./ui/ui.module";
import { UiHomeModule } from "./ui/home/ui-home.module";
import { UiTransitListModule } from "./ui/transit-list/ui-transit-list.module";
import { UiTransitModule } from "./ui/transit/ui-transit.module";
import { UiTransitTabModule } from "./ui/transit/tab/ui-transit-tab.module";
import { UiScrollModule } from "./ui/scroll/ui-scroll.module";
import { UiCampusModule } from "./ui/campus/ui-campus.module";
import { BuildingModule } from "./building/building.module";
import { BuildingCatalogModule } from "./building/catalog/building-catalog.module";
import { BuildingSearchModule } from "./building/search/building-search.module";
import { BuildingCafeteriaListModule } from "./building/cafeteria-list/building-cafeteria-list.module";
import { BuildingPlaceModule } from "./building/place/building-place.module";
import { BuildingPlaceDisplayModule } from "./building/place/display/building-place-display.module";
import { MealsModule } from "./meals/meals.module";
import { MealsCatalogModule } from "./meals/catalog/meals-catalog.module";
import { MealsMenusModule } from "./meals/menus/meals-menus.module";
import { MapModule } from "./map/map.module";
import { MapLayerSetModule } from "./map/layer-set/map-layer-set.module";
import { MapConfigModule } from "./map/config/map-config.module";
import { MapCampusModule } from "./map/campus/map-campus.module";
import { MapTransitModule } from "./map/transit/map-transit.module";
import { MapEventModule } from "./map/event/map-event.module";
import { MapEventDetailsModule } from "./map/event-details/map-event-details.module";
import { NoticesModule } from "./notices/notices.module";
import { NoticesTabsModule } from "./notices/tabs/notices-tabs.module";
import { NoticesListModule } from "./notices/list/notices-list.module";
import { NoticesOverviewModule } from "./notices/overview/notices-overview.module";
import { NoticesAttachmentModule } from "./notices/attachment/notices-attachment.module";
import { NoticesDetailModule } from "./notices/detail/notices-detail.module";
import { NoticesDispatchModule } from "./notices/dispatch/notices-dispatch.module";
import { MiniappsModule } from "./miniapps/miniapps.module";
import { MiniappsSenderModule } from "./miniapps/sender/miniapps-sender.module";
import { MiniappsNotificationsModule } from "./miniapps/notifications/miniapps-notifications.module";
import { MiniappsManifestModule } from "./miniapps/manifest/miniapps-manifest.module";
import { MiniappsCatalogModule } from "./miniapps/catalog/miniapps-catalog.module";
import { GamesModule } from "./games/games.module";
import { SubwayModule } from "./subway/subway.module";
import { SubwayStationsModule } from "./subway/stations/subway-stations.module";
import { SubwayTopologyModule } from "./subway/topology/subway-topology.module";
import { SubwayStationCoordsModule } from "./subway/station-coords/subway-station-coords.module";
import { SubwayStationListModule } from "./subway/station-list/subway-station-list.module";
import { SubwayTimetableModule } from "./subway/timetable/subway-timetable.module";
import { SubwayCountdownModule } from "./subway/countdown/subway-countdown.module";
import { SubwayEstimateModule } from "./subway/estimate/subway-estimate.module";
import { SubwaySeoulApiModule } from "./subway/seoul-api/subway-seoul-api.module";
import { SubwaySeoulTrainmapModule } from "./subway/seoul-trainmap/subway-seoul-trainmap.module";
import { SubwayStateModule } from "./subway/state/subway-state.module";
import { SubwayTrackingModule } from "./subway/tracking/subway-tracking.module";
import { SubwayMatchingModule } from "./subway/matching/subway-matching.module";
import { SubwaySeoulModule } from "./subway/seoul/subway-seoul.module";
import { SubwayPlatformArrivalsModule } from "./subway/platform-arrivals/subway-platform-arrivals.module";
import { SubwayArrivalsModule } from "./subway/arrivals/subway-arrivals.module";
import { SubwayHistoryModule } from "./subway/history/subway-history.module";
import { SubwayTimetableDeparturesModule } from "./subway/timetable/departures/subway-timetable-departures.module";
import { BusDeparturesModule } from "./bus/departures/bus-departures.module";
import { BusDeparturesTimetableModule } from "./bus/departures/timetable/bus-departures-timetable.module";
import { BusDeparturesTopisModule } from "./bus/departures/topis/bus-departures-topis.module";
import { JourneyModule } from "./journey/journey.module";
import { JourneyDeparturesModule } from "./journey/departures/journey-departures.module";
import { JourneyPlacesModule } from "./journey/places/journey-places.module";
import { JourneyRoutesModule } from "./journey/routes/journey-routes.module";

// WHY: imports in boot order: the perimeter ports, config (fails loud on a missing value), the poller registry, then health.
// LangMiddleware is not bound here but in bootstrapHttpApp (src/http/http-app.bootstrap.ts); its QUIRK says why.
@Module({
  imports: [
    PerimeterModule,
    ConfigModule,
    SchedulingModule,
    HealthModule,
    CalendarModule,
    BusModule,
    BusCacheModule,
    BusRegistryModule,
    BusRouteAttributesModule,
    BusRoutePathModule,
    BusHsscRouteLineModule,
    BusRealtimeModule,
    BusRealtimeHsscModule,
    BusRealtimeJongroModule,
    BusRealtimeGbisModule,
    BusRealtimeArrivalModule,
    BusRealtimeGroupModule,
    BusRealtimeHsscEtaModule,
    BusStopsModule,
    BusScheduleContentModule,
    BusScheduleModule,
    BusEtaModule,
    BusEtaLaneModule,
    BusEtaProbeModule,
    BusEtaTravelModule,
    BusEtaForecastModule,
    BusEtaLiveModule,
    BusEtaBaselineModule,
    BusEtaSmartModule,
    BusConfigModule,
    BusLiveModule,
    BusLiveJongroModule,
    BusLiveHsscModule,
    BusLiveGroupModule,
    BusStopIndexModule,
    BusStopArrivalsModule,
    BusStopListModule,
    AppConfigModule,
    UiModule,
    UiHomeModule,
    UiTransitListModule,
    UiTransitModule,
    UiTransitTabModule,
    UiScrollModule,
    UiCampusModule,
    BuildingModule,
    // WHY: before BuildingCatalogModule: Nest registers routes in module order, and /building/:skkuId would catch
    // /building/search (route-order.test.ts).
    BuildingSearchModule,
    BuildingCatalogModule,
    BuildingCafeteriaListModule,
    BuildingPlaceModule,
    BuildingPlaceDisplayModule,
    MealsModule,
    MealsCatalogModule,
    MealsMenusModule,
    MapModule,
    MapLayerSetModule,
    MapConfigModule,
    MapCampusModule,
    MapTransitModule,
    MapEventModule,
    MapEventDetailsModule,
    NoticesModule,
    NoticesTabsModule,
    NoticesListModule,
    NoticesOverviewModule,
    NoticesAttachmentModule,
    // WHY: last of the /notices routes: /notices/:sourceId/:articleNo would catch every two-segment path above.
    NoticesDetailModule,
    NoticesDispatchModule,
    MiniappsModule,
    MiniappsSenderModule,
    MiniappsNotificationsModule,
    MiniappsManifestModule,
    MiniappsCatalogModule,
    GamesModule,
    SubwayModule,
    SubwayStationsModule,
    SubwayTopologyModule,
    SubwayStationCoordsModule,
    SubwayStationListModule,
    SubwayTimetableModule,
    SubwayCountdownModule,
    SubwayEstimateModule,
    SubwaySeoulApiModule,
    SubwaySeoulTrainmapModule,
    SubwayStateModule,
    SubwayTrackingModule,
    SubwayMatchingModule,
    SubwaySeoulModule,
    SubwayPlatformArrivalsModule,
    SubwayArrivalsModule,
    SubwayHistoryModule,
    SubwayTimetableDeparturesModule,
    BusDeparturesModule,
    BusDeparturesTimetableModule,
    BusDeparturesTopisModule,
    JourneyModule,
    JourneyDeparturesModule,
    JourneyPlacesModule,
    JourneyRoutesModule,
  ],
})
export class AppModule {}
