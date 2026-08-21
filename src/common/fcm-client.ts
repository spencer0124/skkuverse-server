import config from "../infra/config";

/**
 * The one place this codebase POSTs to the `sendNotification` Cloud Function.
 *
 * Extracted from NoticesDispatcherService when the mini-app send path and the
 * event map's silent refresh both needed the same call. Three copies of
 * "fetch, abort on a timeout, parse a body that may not be JSON, throw with the
 * status attached" is how one of them quietly loses its timeout and hangs a
 * request until the platform kills it.
 *
 * Config stays in `config.notices.dispatch` rather than moving to a neutral
 * block: it is one function URL and one API key, and every caller is us. The
 * event map's internal route already documents the same reasoning for sharing
 * INTERNAL_DISPATCH_TOKEN — a second env var for the same secret is one more
 * thing to have missing on the host at 22:00.
 */

export interface FcmResponse {
  sent?: number;
  failed?: number;
  cleanedUp?: number;
  [k: string]: unknown;
}

/** Anything the Cloud Function's `type` switch accepts. */
export type FcmPayload = Record<string, unknown> & { type: string };

/**
 * Throws on a non-2xx with `status` attached, so callers can distinguish
 * "the function rejected this payload" from "the network went away".
 */
export async function postToFcmFunction(payload: FcmPayload): Promise<FcmResponse> {
  const { functionUrl, apiKey, fcmTimeoutMs } = config.notices.dispatch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fcmTimeoutMs);
  try {
    const res = await fetch(functionUrl!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey!,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: FcmResponse | { raw: string } | null = null;
    try {
      body = text ? (JSON.parse(text) as FcmResponse) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(
        `sendNotification ${res.status}: ${typeof body === "object" ? JSON.stringify(body) : text}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (body as FcmResponse) || {};
  } finally {
    clearTimeout(timer);
  }
}
