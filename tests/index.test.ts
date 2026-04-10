/**
 * Integration tests for the CookieAgent and cookie() interceptor (undici v7/v8).
 *
 * These spin up a real HTTP server and exercise the full cookie round-trip:
 *   1. Server sets a cookie → agent stores it in the jar
 *   2. Agent sends the stored cookie on the next request
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CookieJar } from 'tough-cookie'
import { request, fetch, Agent, upgrade } from 'undici'
import { CookieAgent, cookie, createCookieAgent } from '../src/index.js'
import { createTestServer, parseCookieString } from './helpers.js'
import type { TestServer } from './helpers.js'

let server: TestServer

beforeEach(async () => {
  ;({ server } = await createTestServer())
})

afterEach(async () => {
  await server.close()
})

// ---------------------------------------------------------------------------
// CookieAgent - basic cookie storage and retrieval
// ---------------------------------------------------------------------------

describe('CookieAgent (v7/v8)', () => {
  it('stores Set-Cookie headers in the jar', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    await request(`${server.baseUrl}/set-cookie`, { dispatcher: agent })

    const cookies = jar.getCookiesSync(`${server.baseUrl}/`)
    expect(cookies).toHaveLength(1)
    expect(cookies[0].key).toBe('session')
    expect(cookies[0].value).toBe('abc123')

    await agent.close()
  })

  it('sends stored cookies on subsequent requests', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    // First request: server sets a cookie
    await request(`${server.baseUrl}/set-cookie`, { dispatcher: agent })

    // Second request: agent should send the cookie back
    const { body } = await request(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
    })
    const data = await body.json() as { cookie: string }

    const cookies = parseCookieString(data.cookie)
    expect(cookies['session']).toBe('abc123')

    await agent.close()
  })

  it('stores multiple Set-Cookie headers', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    await request(`${server.baseUrl}/set-cookie-multi`, { dispatcher: agent })

    const cookies = jar.getCookiesSync(`${server.baseUrl}/`)
    const names = cookies.map((c) => c.key)

    expect(names).toContain('user')
    expect(names).toContain('theme')
    expect(names).toContain('lang')

    await agent.close()
  })

  it('sends multiple cookies as a single Cookie header', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    await request(`${server.baseUrl}/set-cookie-multi`, { dispatcher: agent })

    const { body } = await request(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
    })
    const data = await body.json() as { cookie: string }
    const cookies = parseCookieString(data.cookie)

    expect(cookies['user']).toBe('alice')
    expect(cookies['theme']).toBe('dark')
    expect(cookies['lang']).toBe('en')

    await agent.close()
  })

  it('merges manually set cookies with jar cookies', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    // Put a cookie in the jar first
    jar.setCookieSync('jar_cookie=from_jar', `${server.baseUrl}/`)

    const { body } = await request(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
      headers: { cookie: 'manual_cookie=from_header' },
    })
    const data = await body.json() as { cookie: string }
    const cookies = parseCookieString(data.cookie)

    expect(cookies['jar_cookie']).toBe('from_jar')
    expect(cookies['manual_cookie']).toBe('from_header')

    await agent.close()
  })

  it('works with flat string[] headers', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    jar.setCookieSync('flat=yes', `${server.baseUrl}/`)

    const { body } = await request(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
      headers: ['x-custom', 'value'],
    })
    const data = await body.json() as { cookie: string }
    const cookies = parseCookieString(data.cookie)

    expect(cookies['flat']).toBe('yes')

    await agent.close()
  })

  it('does not mix cookies between different origins', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    // Set a cookie scoped to a different domain
    jar.setCookieSync('other=1', 'https://other.example.com/')

    const { body } = await request(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
    })
    const data = await body.json() as { cookie: string }

    // The `other` cookie should NOT be sent to localhost
    expect(data.cookie).toBe('')

    await agent.close()
  })

  it('shares the jar between multiple request calls', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    await request(`${server.baseUrl}/set-cookie`, { dispatcher: agent })
    await request(`${server.baseUrl}/set-cookie-multi`, { dispatcher: agent })

    const cookies = jar.getCookiesSync(`${server.baseUrl}/`)
    const names = cookies.map((c) => c.key)

    expect(names).toContain('session')
    expect(names).toContain('user')
    expect(names).toContain('theme')
    expect(names).toContain('lang')

    await agent.close()
  })

  it('accepts Agent.Options alongside cookie options', async () => {
    const jar = new CookieJar()
    // Pass an Agent option (keepAliveTimeout) alongside cookies
    const agent = new CookieAgent({
      cookies: { jar },
      keepAliveTimeout: 5000,
    })

    await request(`${server.baseUrl}/set-cookie`, { dispatcher: agent })
    const cookies = jar.getCookiesSync(`${server.baseUrl}/`)
    expect(cookies.length).toBeGreaterThan(0)

    await agent.close()
  })

  it('invokes onResponseError when the connection fails', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    // Port 1 is reserved and will always refuse connections
    await expect(
      request('http://localhost:1/', { dispatcher: agent }),
    ).rejects.toThrow()

    await agent.close()
  })

  it('handles HTTP upgrade responses via onRequestUpgrade', async () => {
    const jar = new CookieJar()
    jar.setCookieSync('session=abc123', server.baseUrl)
    const agent = new CookieAgent({ cookies: { jar } })

    const { socket } = await upgrade(server.baseUrl, {
      dispatcher: agent,
      upgrade: 'websocket',
    })
    socket.destroy()

    await agent.close()
  })
})

// ---------------------------------------------------------------------------
// cookie() interceptor
// ---------------------------------------------------------------------------

describe('cookie() interceptor (v7/v8)', () => {
  it('stores and sends cookies when composed with a fresh Agent', async () => {
    const jar = new CookieJar()
    const agent = new Agent().compose(cookie({ cookies: { jar } }))

    await request(`${server.baseUrl}/set-cookie`, { dispatcher: agent })

    const { body } = await request(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
    })
    const data = await body.json() as { cookie: string }
    const cookies = parseCookieString(data.cookie)

    expect(cookies['session']).toBe('abc123')

    await (agent as Agent).close()
  })

  it('can be composed with multiple interceptors', async () => {
    const jar = new CookieJar()
    // Add a custom header interceptor alongside cookie
    const addHeader = (dispatch: any) => (opts: any, handler: any) => {
      const headers = { ...(opts.headers ?? {}), 'x-intercepted': 'yes' }
      return dispatch({ ...opts, headers }, handler)
    }

    const agent = new Agent().compose(cookie({ cookies: { jar } }), addHeader)

    await request(`${server.baseUrl}/set-cookie`, { dispatcher: agent })

    const { body } = await request(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
    })
    const data = await body.json() as { cookie: string }
    const cookies = parseCookieString(data.cookie)

    expect(cookies['session']).toBe('abc123')

    await (agent as Agent).close()
  })
})

// ---------------------------------------------------------------------------
// createCookieAgent() mixin
// ---------------------------------------------------------------------------

describe('createCookieAgent() mixin (v7/v8)', () => {
  it('wraps Agent class and handles cookies', async () => {
    const CookieWrapped = createCookieAgent(Agent)
    const jar = new CookieJar()
    const agent = new CookieWrapped({ cookies: { jar } })

    await request(`${server.baseUrl}/set-cookie`, { dispatcher: agent })

    const { body } = await request(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
    })
    const data = await body.json() as { cookie: string }
    const cookies = parseCookieString(data.cookie)

    expect(cookies['session']).toBe('abc123')

    await (agent as any).close()
  })

  it('throws when no cookies option is provided', () => {
    const CookieWrapped = createCookieAgent(Agent)
    expect(() => new CookieWrapped({ keepAliveTimeout: 1000 })).toThrow(
      /cookies\.jar/,
    )
  })
})

// ---------------------------------------------------------------------------
// Works with undici.fetch
// ---------------------------------------------------------------------------

describe('CookieAgent with undici fetch (v7/v8)', () => {
  it('stores and sends cookies across fetch calls', async () => {
    const jar = new CookieJar()
    const agent = new CookieAgent({ cookies: { jar } })

    await fetch(`${server.baseUrl}/set-cookie`, { dispatcher: agent })

    const res = await fetch(`${server.baseUrl}/echo-cookies`, {
      dispatcher: agent,
    })
    const data = await res.json() as { cookie: string }
    const cookies = parseCookieString(data.cookie)

    expect(cookies['session']).toBe('abc123')

    await agent.close()
  })
})
