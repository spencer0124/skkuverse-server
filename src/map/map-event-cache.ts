/**
 * Origin cache policy for the event map's read path — the activation lookup,
 * the overlay projection and the place details (see `createCachedLoader`).
 *
 * Every client that opens the map asks for the same three answers, so without
 * a cache the database sees each request. With one, each replica reads at most
 * once per TTL per answer, whatever the request rate.
 *
 * The TTL is how late an ops change shows up at the origin: an activation
 * opened, closed or disabled — or a place re-imported — reaches `/map/config`
 * within one TTL, and the overlay and detail routes within two (their cache
 * sits over the activation cache). An activation's own `activeUntil` is exact:
 * a cached activation is re-checked against the clock on every request. Edge
 * and device caching (`Cache-Control` on the overlay routes) comes on top.
 *
 * The stale window covers a database blip. During one, ops cannot change an
 * activation or a place either — they live in the same cluster — so the last
 * good answer is the freshest one available; the bound only guards a replica
 * that is cut off on its own.
 *
 * Kept apart from the modules that use it so a test that mocks one of them
 * wholesale cannot take these numbers with it.
 */
export const EVENT_CACHE_TTL_MS = 5_000;
export const EVENT_STALE_IF_ERROR_MS = 10 * 60_000;
