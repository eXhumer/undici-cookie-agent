/**
 * undici-cookie-agent - entry point for undici v7 and v8.
 *
 * Uses the handler API introduced in v7 and carried forward in v8:
 *   onRequestStart / onResponseStart / onResponseData / onResponseEnd /
 *   onResponseError / onRequestUpgrade.
 *
 * Import path:
 *   import { CookieAgent, cookie } from 'undici-cookie-agent'
 */

import { Agent } from 'undici'
import type { Dispatcher } from 'undici'
import type { CookieJar } from 'tough-cookie'
import {
  type CookieAgentOptions,
  buildUrl,
  injectCookieHeader,
  extractSetCookiesFromObject,
  persistCookies,
} from './shared.js'

export type { CookieAgentOptions, CookieOptions } from './shared.js'

// ---------------------------------------------------------------------------
// CookieHandler - wraps an existing handler, intercepts response headers
// ---------------------------------------------------------------------------

/**
 * A dispatch handler that intercepts the response to persist Set-Cookie
 * headers into the jar.  Works with the v7 / v8 handler contract.
 */
class CookieHandler implements Dispatcher.DispatchHandler {
  constructor(
    private readonly inner: Dispatcher.DispatchHandler,
    private readonly url: string,
    private readonly jar: CookieJar,
  ) {}

  // Called just before the request is written on the wire.
  onRequestStart(
    controller: Dispatcher.DispatchController,
    context: object,
  ): void {
    this.inner.onRequestStart?.(controller, context)
  }

  // Called when the status line + headers have been received.
  // This is where we harvest Set-Cookie headers.
  onResponseStart(
    controller: Dispatcher.DispatchController,
    statusCode: number,
    headers: Record<string, string | string[] | undefined>,
    statusMessage?: string,
  ): void {
    const setCookies = extractSetCookiesFromObject(headers)
    persistCookies(this.jar, this.url, setCookies)
    this.inner.onResponseStart?.(controller, statusCode, headers, statusMessage)
  }

  onResponseData(controller: Dispatcher.DispatchController, chunk: Buffer): void {
    this.inner.onResponseData?.(controller, chunk)
  }

  onResponseEnd(
    controller: Dispatcher.DispatchController,
    trailers: Record<string, string | string[] | undefined>,
  ): void {
    this.inner.onResponseEnd?.(controller, trailers)
  }

  onResponseError(controller: Dispatcher.DispatchController, err: Error): void {
    this.inner.onResponseError?.(controller, err)
  }

  // Optional: upgrade support (WebSocket, HTTP/2 upgrade, CONNECT)
  onRequestUpgrade(
    controller: Dispatcher.DispatchController,
    statusCode: number,
    headers: Record<string, string | string[] | undefined>,
    socket: import('stream').Duplex,
  ): void {
    this.inner.onRequestUpgrade?.(controller, statusCode, headers, socket)
  }
}

// ---------------------------------------------------------------------------
// cookie() - interceptor for use with dispatcher.compose()
// ---------------------------------------------------------------------------

/**
 * Returns an undici interceptor that transparently adds and saves cookies.
 *
 * @example
 * ```ts
 * import { fetch, ProxyAgent } from 'undici'
 * import { CookieJar } from 'tough-cookie'
 * import { cookie } from 'undici-cookie-agent'
 *
 * const jar = new CookieJar()
 * const agent = new ProxyAgent('http://proxy:8080').compose(cookie({ jar }))
 * await fetch('https://example.com', { dispatcher: agent })
 * ```
 */
export function cookie(options: CookieAgentOptions): Dispatcher.DispatcherComposeInterceptor {
  const { jar } = options.cookies
  return (dispatch) =>
    (opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) => {
      const url = buildUrl(opts)
      const cookieString = jar.getCookieStringSync(url)
      const headers = injectCookieHeader(opts.headers, cookieString)
      return dispatch({ ...opts, headers }, new CookieHandler(handler, url, jar))
    }
}

// ---------------------------------------------------------------------------
// CookieAgent - drop-in replacement for undici.Agent
// ---------------------------------------------------------------------------

/**
 * An undici Agent subclass that automatically handles cookies via a
 * tough-cookie CookieJar.
 *
 * @example
 * ```ts
 * import { fetch } from 'undici'
 * import { CookieJar } from 'tough-cookie'
 * import { CookieAgent } from 'undici-cookie-agent'
 *
 * const jar  = new CookieJar()
 * const agent = new CookieAgent({ cookies: { jar } })
 *
 * await fetch('https://example.com', { dispatcher: agent })
 * ```
 */
export class CookieAgent extends Agent {
  readonly #jar: CookieJar

  constructor(options: Agent.Options & CookieAgentOptions) {
    const { cookies, ...agentOptions } = options
    super(agentOptions)
    this.#jar = cookies.jar
  }

  dispatch(
    opts: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    const url = buildUrl(opts)
    const cookieString = this.#jar.getCookieStringSync(url)
    const headers = injectCookieHeader(opts.headers, cookieString)
    return super.dispatch(
      { ...opts, headers },
      new CookieHandler(handler, url, this.#jar),
    )
  }
}

// ---------------------------------------------------------------------------
// createCookieAgent - mixin for arbitrary Agent subclasses
// ---------------------------------------------------------------------------

/**
 * Wraps *any* undici Agent subclass with cookie handling.
 *
 * @example
 * ```ts
 * import { ProxyAgent } from 'undici'
 * import { CookieJar } from 'tough-cookie'
 * import { createCookieAgent } from 'undici-cookie-agent'
 *
 * const CookieProxyAgent = createCookieAgent(ProxyAgent)
 * const jar = new CookieJar()
 * const agent = new CookieProxyAgent('http://proxy:8080', { cookies: { jar } })
 * ```
 */
export function createCookieAgent<
  TBase extends new (...args: any[]) => Agent,
>(Base: TBase) {
  return class CookieWrappedAgent extends Base {
    readonly #jar: CookieJar

    constructor(...args: any[]) {
      super(...args)
      // Expect cookie options in the last argument that is a plain object
      const cookieOpts = findCookieOptions(args)
      if (!cookieOpts) {
        throw new TypeError(
          'createCookieAgent: no `cookies.jar` option found in constructor arguments',
        )
      }
      this.#jar = cookieOpts.jar
    }

    dispatch(
      opts: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandler,
    ): boolean {
      const url = buildUrl(opts)
      const cookieString = this.#jar.getCookieStringSync(url)
      const headers = injectCookieHeader(opts.headers, cookieString)
      return super.dispatch(
        { ...opts, headers },
        new CookieHandler(handler, url, this.#jar),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findCookieOptions(args: unknown[]): CookieAgentOptions['cookies'] | null {
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i]
    if (
      arg !== null &&
      typeof arg === 'object' &&
      'cookies' in arg &&
      arg.cookies !== null &&
      typeof (arg as any).cookies === 'object' &&
      'jar' in (arg as any).cookies
    ) {
      return (arg as CookieAgentOptions).cookies
    }
  }
  return null
}
