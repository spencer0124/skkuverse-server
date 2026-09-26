/**
 * Fetches each first-party mini app's own `public/skkuverse.json` manifest and
 * merges its `shell` fields into `GET /miniapps/:id` (see `miniapps.controller.ts`).
 *
 * The registry (`index.json`/`details/*.json`) still owns identity — startUrl,
 * name, verified, logos — and now only a FALLBACK shell. The manifest, served
 * from the mini app's own origin, is the presentation source of truth: it can
 * change what the app draws around the page without a server deploy.
 *
 * "First-party" is deliberately narrow: only a startUrl whose origin is on
 * FIRST_PARTY_MINIAPP_ORIGINS (`../infra/origins.ts`) is fetched at all. The
 * third-party sites keep exactly their registry shell — this module never
 * reaches out to a host we do not operate.
 *
 * One `CachedLoader` per first-party id (`../common/cache/cached-loader.ts`):
 * 5-minute TTL, an effectively unbounded stale window, so once a manifest has
 * been fetched at least once, a down or slow origin never blocks a request —
 * `getShellFields` always falls back to `{}` (no override) rather than letting
 * a manifest failure fail the mini app's own detail response. Prefetched at
 * module init, fire-and-forget, so one mini app being down cannot delay boot
 * or any other mini app's prefetch.
 */
import { Injectable, type OnModuleInit } from "@nestjs/common";
import logger from "../infra/logger";
import { FIRST_PARTY_MINIAPP_ORIGINS } from "../infra/origins";
import { createCachedLoader, type CachedLoader } from "../common/cache/cached-loader";
import { MANIFEST_PATH, parseShellFields, type ShellConfig } from "./shell";
import { MiniAppsService } from "./miniapps.service";
import type { MiniAppDetail } from "./types";

/** A manifest fetch aborts after this long — a slow origin must not hold up a request. */
export const FETCH_TIMEOUT_MS = 3_000;
/** Refuse a manifest body over this size, whether announced or actually read. */
export const MAX_MANIFEST_BYTES = 16 * 1024;
/** How long a fetched manifest is served before it is fetched again. */
export const CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Once a manifest has ever loaded, keep serving it for this long past its TTL
 * while retries fail in the background. Effectively "forever" — the whole
 * point of stale-while-revalidate here is that a mini app's own outage must
 * never make ITS OWN detail response fail or hang.
 */
const STALE_FOREVER_MS = Number.MAX_SAFE_INTEGER;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The first-party origin to fetch a manifest from, or null when this id is not first-party. */
export function firstPartyOrigin(startUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(startUrl);
  } catch {
    return null;
  }
  return (FIRST_PARTY_MINIAPP_ORIGINS as readonly string[]).includes(url.origin) ? url.origin : null;
}

/**
 * Reads a fetch `Response` body up to `maxBytes`, throwing rather than ever
 * buffering more than that many bytes — a `Content-Length` header can lie or
 * be absent (chunked transfer), so the announced size alone is not a bound.
 */
async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    // No streaming body (e.g. a test double). Fall back to a plain read; test
    // doubles construct small fixtures, so this path never sees a real oversized body.
    return res.text();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`manifest body exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/**
 * Fetches and parses one mini app's manifest. Throws on anything untrustworthy
 * — bad status, a redirect, an oversized or unparsable body — so the caller
 * (the `CachedLoader`'s `load`) can tell a real fetch from a fallback.
 */
async function fetchManifestShellFields(origin: string): Promise<Partial<ShellConfig>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}${MANIFEST_PATH}`, {
      redirect: "manual",
      signal: controller.signal,
    });
    // `redirect: "manual"` turns a real redirect into an opaque response (status
    // 0, type "opaqueredirect") rather than following it. Some fetch mocks
    // instead hand back the raw 3xx, so both shapes are treated as a failure.
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      throw new Error(`manifest redirected from ${origin}`);
    }
    if (!res.ok) {
      throw new Error(`manifest ${res.status} from ${origin}`);
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_MANIFEST_BYTES) {
      throw new Error(`manifest content-length exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    const text = await readBounded(res, MAX_MANIFEST_BYTES);
    const json: unknown = JSON.parse(text);
    const shell = isRecord(json) ? json.shell : undefined;
    return parseShellFields(shell);
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class MiniAppsManifestService implements OnModuleInit {
  private readonly loaders = new Map<string, CachedLoader<Partial<ShellConfig>>>();

  constructor(private readonly miniApps: MiniAppsService) {}

  /** Builds one loader per first-party registry entry. Never throws. */
  onModuleInit(): void {
    for (const detail of this.miniApps.map.values()) {
      const origin = firstPartyOrigin(detail.startUrl);
      if (!origin) continue;
      const loader = this.loaderFor(detail.id, origin);
      // Prefetch, fire-and-forget: boot must not wait on a network call, and a
      // down mini app must not stop another mini app's prefetch or the app itself.
      loader.get().catch((err: unknown) => {
        logger.warn(
          { miniAppId: detail.id, origin, err: errMessage(err) },
          "[miniapps] manifest prefetch failed; serving the registry's own shell for now",
        );
      });
    }
  }

  private loaderFor(id: string, origin: string): CachedLoader<Partial<ShellConfig>> {
    const existing = this.loaders.get(id);
    if (existing) return existing;
    const loader = createCachedLoader<Partial<ShellConfig>>({
      name: `miniapp-manifest:${id}`,
      ttlMs: CACHE_TTL_MS,
      staleWindowMs: STALE_FOREVER_MS,
      load: () => fetchManifestShellFields(origin),
    });
    this.loaders.set(id, loader);
    return loader;
  }

  /**
   * The manifest's shell fields for one mini app's detail, or `{}` — never
   * fetched (not first-party), never yet fetched successfully, or fetched but
   * currently failing. `{}` merges as "no override" (`mergeShell`), so the
   * registry's own shell (already merged over `DEFAULT_SHELL` by the caller)
   * is exactly what a mini app that has shipped no manifest yet keeps showing.
   */
  async getShellFields(detail: Pick<MiniAppDetail, "id" | "startUrl">): Promise<Partial<ShellConfig>> {
    const origin = firstPartyOrigin(detail.startUrl);
    if (!origin) return {};
    try {
      return await this.loaderFor(detail.id, origin).get();
    } catch (err) {
      logger.warn(
        { miniAppId: detail.id, origin, err: errMessage(err) },
        "[miniapps] manifest fetch failed; serving the registry's own shell",
      );
      return {};
    }
  }
}
