# Refactoring Roadmap

Prioritized list of refactoring tasks for the skkumap-server-express codebase.
Updated: 2026-03-01

## Completed

- [x] Ad system — MongoDB migration with placement-based architecture
- [x] Environment separation — dev/production DB + API flag system
- [x] Campus schedule (`features/bus/campus.data.js`) — Fix connection leak, remove DB writes on GET, add caching
- [x] Station module (`features/station/`) — Extract ETA to pure functions, eliminate shared state mutation, remove debug logs, add `STALE_THRESHOLD_SECONDS` constant
- [x] HSSC/Jongro fetcher cleanup (`features/bus/`) — Removed heartbeat ping, added named constants (`STALE_MINUTES_*`, `toLinearSequence()`), fixed Jongro station mutation (functional `map()`), renamed `HSSCStations` → `stations` response key (blue-green with Flutter), cleaned error logging with `[hssc]`/`[jongro]` prefixes
- [x] Search module (`features/search/`) — Fixed `bulidingInfo` → `buildingInfo` typo (blue-green with Flutter), added try-catch error handling with `[search]` prefix to all 3 modules, fixed loose equality (`==` → `===`), added 11 tests (coverage: building 100%, space 100%, helpers 100%, detail 86%)
- [x] Response format standardization — Unified `metadata` → `metaData` (HSSC/Jongro routes), `StationData` → `stationData` (station route), coordinated Flutter model updates. All endpoints now consistently use `metaData` (PascalCase) and camelCase data keys.

## All Steps Complete

The refactoring roadmap is fully implemented. All 5 prioritized steps have been completed with coordinated server + Flutter changes and comprehensive test coverage (117 tests, 73% overall coverage).

> **Note (2026-03-02)**: A subsequent API v2 migration replaced the `metaData` → camelCase convention with a fully standardized `{ meta, data }` envelope across all endpoints. The snake_case fields in station routes were also migrated to camelCase. See `docs/api-migration-v2.md` for the current API contract.
