/**
 * Origin cache policy for the event map's read path — the activation lookup,
 * the overlay projection and the place details (see `createCachedLoader`).
 *
 * Every client that opens the map asks for the same three answers, so without
 * a cache the database sees each request. With one, each replica reads at most
 * once per TTL per answer, whatever the request rate.
 *
 * The TTL is roughly how late an ops change shows up at the origin: an
 * activation opened, closed or disabled — or a place re-imported — reaches
 * `/map/config` about one TTL later, and the overlay and detail routes about
 * two (their cache sits over the activation cache). "About", because the
 * first request after an expiry is still answered from the old value while
 * the reload runs behind it. An activation's own `activeUntil` is exact: a
 * cached activation is re-checked against the clock on every request. Edge and
 * device caching (`Cache-Control` on the overlay routes) comes on top.
 *
 * The stale window is what keeps a database blip off the request path: an
 * expired answer is served at once while the reload runs, and kept while
 * reloads fail. During a blip ops cannot change an activation or a place
 * either — they live in the same cluster — so the last good answer is the
 * freshest one available; the bound only guards a replica that is cut off on
 * its own.
 *
 * Kept apart from the modules that use it so a test that mocks one of them
 * wholesale cannot take these numbers with it.
 */
export const EVENT_CACHE_TTL_MS = 5_000;
export const EVENT_STALE_WINDOW_MS = 10 * 60_000;
