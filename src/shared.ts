/**
 * Shared utilities used across all undici version implementations.
 */

import type { CookieJar } from 'tough-cookie'
import type { Dispatcher } from 'undici'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CookieOptions {
  /** The tough-cookie CookieJar to read from and write to. */
  jar: CookieJar
}

export interface CookieAgentOptions {
  cookies: CookieOptions
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Build a full URL string from undici dispatch options.
 * undici splits the URL into `origin` and `path`; we reunite them here so
 * tough-cookie can look up and store cookies properly.
 */
export function buildUrl(opts: Dispatcher.DispatchOptions): string {
  const origin =
    opts.origin instanceof URL
      ? opts.origin.href
      : (opts.origin as string | undefined) ?? ''

  const path = opts.path ?? '/'
  try {
    return new URL(path, origin).href
  } catch {
    // Fallback for unusual cases (e.g. CONNECT tunnels)
    return origin + path
  }
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

/**
 * undici accepts headers in three different shapes on DispatchOptions:
 *   - null / undefined
 *   - string[] flat pair array  ["name", "value", ...]
 *   - Record<string, string | string[]>
 *
 * This helper injects a `cookie` header value into any of those shapes,
 * merging with an existing cookie header when one is present.
 */
export function injectCookieHeader(
  headers: Dispatcher.DispatchOptions['headers'],
  cookieString: string,
): Dispatcher.DispatchOptions['headers'] {
  // Nothing to add
  if (!cookieString) return headers

  // --- Array form ---
  if (Array.isArray(headers)) {
    const result = [...headers]
    for (let i = 0; i < result.length; i += 2) {
      if (String(result[i]).toLowerCase() === 'cookie') {
        // Merge with existing cookie header
        result[i + 1] = `${result[i + 1]}; ${cookieString}`
        return result
      }
    }
    // Append new cookie header
    return [...result, 'cookie', cookieString]
  }

  // --- Object / undefined / null form ---
  const existing: Record<string, string | string[]> =
    headers && typeof headers === 'object'
      ? { ...(headers as Record<string, string | string[]>) }
      : {}

  // Normalise both `cookie` and `Cookie` keys (prefer lower-case).
  // We always write to the lower-case key and remove any mixed-case dupe.
  const lcKey = Object.keys(existing).find((k) => k.toLowerCase() === 'cookie')
  if (lcKey) {
    const prev = existing[lcKey]
    // Remove the original (possibly mixed-case) key so we don't have two keys
    if (lcKey !== 'cookie') delete existing[lcKey]
    existing['cookie'] = `${Array.isArray(prev) ? prev.join('; ') : prev}; ${cookieString}`
  } else {
    existing['cookie'] = cookieString
  }

  return existing
}

// ---------------------------------------------------------------------------
// Response Set-Cookie extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract Set-Cookie values from headers delivered by the **new** undici
 * handler API (v7+).  In this API, headers arrive as a plain object.
 * Values can be `undefined` per the `IncomingHttpHeaders` type.
 */
export function extractSetCookiesFromObject(
  headers: Record<string, string | string[] | undefined>,
): string[] {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'set-cookie')
  if (!key) return []
  const val = headers[key]
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

// ---------------------------------------------------------------------------
// Shared cookie persistence helper
// ---------------------------------------------------------------------------

/**
 * Persist a list of raw Set-Cookie strings into the jar for the given URL.
 * Errors are silently swallowed (ignoreError) so a malformed Set-Cookie
 * header never crashes the request.
 */
export function persistCookies(jar: CookieJar, url: string, setCookies: string[]): void {
  for (const raw of setCookies) {
    try {
      jar.setCookieSync(raw, url, { ignoreError: true })
    } catch {
      // Intentionally ignored - bad cookies must not kill the pipeline
    }
  }
}
