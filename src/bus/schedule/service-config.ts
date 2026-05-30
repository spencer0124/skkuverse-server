/**
 * Re-export of features/bus/service.config (static, read-only shared import).
 * Keeps the serviceId → operational defaults map a single source of truth.
 *
 * Note: the original uses `export =`; we re-import and re-export as a named
 * binding so it's consumable from ESM-style imports in the Nest tree.
 */
import serviceConfig from "../../../features/bus/service.config";

export default serviceConfig;
