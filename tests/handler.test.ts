import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { CookieJar } from 'tough-cookie'
import { cookie } from '../src/index.js'
import type { Dispatcher } from 'undici'

describe('cookie() dispatch handler', () => {
  it('injects cookies, persists response cookies, and forwards every callback', () => {
    const url = 'https://example.com/resource'
    const jar = new CookieJar()
    jar.setCookieSync('request_cookie=yes; Path=/', url)

    const controller = {} as Dispatcher.DispatchController
    const context = { request: true }
    const chunk = Buffer.from('response')
    const trailers = { 'x-trailer': 'value' }
    const error = new Error('connection failed')
    const socket = new PassThrough()

    const inner: Dispatcher.DispatchHandler = {
      onRequestStart: vi.fn(),
      onResponseStart: vi.fn(() => {
        expect(jar.getCookiesSync(url).map((item) => item.key)).toContain(
          'response_cookie',
        )
      }),
      onResponseData: vi.fn(),
      onResponseEnd: vi.fn(),
      onResponseError: vi.fn(),
      onRequestUpgrade: vi.fn(),
    }

    let wrappedHandler: Dispatcher.DispatchHandler | undefined
    const dispatch = vi.fn(
      (opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) => {
        expect(opts.headers).toEqual({ cookie: 'request_cookie=yes' })
        wrappedHandler = handler
        return true
      },
    )
    const dispatchOptions: Dispatcher.DispatchOptions = {
      origin: 'https://example.com',
      path: '/resource',
      method: 'GET',
    }

    const result = cookie({ cookies: { jar } })(dispatch)(dispatchOptions, inner)

    expect(result).toBe(true)
    expect(dispatchOptions.headers).toBeUndefined()
    expect(wrappedHandler).toBeDefined()

    wrappedHandler!.onRequestStart?.(controller, context)
    wrappedHandler!.onResponseStart?.(
      controller,
      200,
      { 'set-cookie': 'response_cookie=yes; Path=/' },
      'OK',
    )
    wrappedHandler!.onResponseData?.(controller, chunk)
    wrappedHandler!.onResponseEnd?.(controller, trailers)
    wrappedHandler!.onResponseError?.(controller, error)
    wrappedHandler!.onRequestUpgrade?.(controller, 101, {}, socket)

    expect(inner.onRequestStart).toHaveBeenCalledWith(controller, context)
    expect(inner.onResponseStart).toHaveBeenCalledWith(
      controller,
      200,
      { 'set-cookie': 'response_cookie=yes; Path=/' },
      'OK',
    )
    expect(inner.onResponseData).toHaveBeenCalledWith(controller, chunk)
    expect(inner.onResponseEnd).toHaveBeenCalledWith(controller, trailers)
    expect(inner.onResponseError).toHaveBeenCalledWith(controller, error)
    expect(inner.onRequestUpgrade).toHaveBeenCalledWith(
      controller,
      101,
      {},
      socket,
    )
  })
})
