/**
 * Test helpers - a minimal HTTP server that exercises cookie round-trips.
 */

import http from 'node:http'
import { once } from 'node:events'

export interface TestServer {
  port: number
  baseUrl: string
  close(): Promise<void>
}

export interface RequestRecord {
  url: string
  headers: Record<string, string | string[] | undefined>
}

/**
 * Creates a simple HTTP server for cookie testing.
 *
 * Routes:
 *   GET /set-cookie            - responds with Set-Cookie headers
 *   GET /set-cookie-multi      - responds with multiple Set-Cookie headers
 *   GET /echo-cookies          - echoes the received Cookie header as JSON
 *   GET /redirect              - 302 → /echo-cookies (tests cookies across redirects)
 *   GET /set-and-redirect      - sets a cookie AND redirects to /echo-cookies
 */
export async function createTestServer(): Promise<{
  server: TestServer
  requests: RequestRecord[]
}> {
  const requests: RequestRecord[] = []

  const httpServer = http.createServer((req, res) => {
    const record: RequestRecord = {
      url: req.url ?? '/',
      headers: req.headers as Record<string, string | string[] | undefined>,
    }
    requests.push(record)

    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/set-cookie') {
      res.setHeader('Set-Cookie', 'session=abc123; Path=/')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (url.pathname === '/set-cookie-multi') {
      // Multiple Set-Cookie headers
      res.setHeader('Set-Cookie', [
        'user=alice; Path=/',
        'theme=dark; Path=/',
        'lang=en; Path=/',
      ])
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (url.pathname === '/echo-cookies') {
      const cookieHeader = req.headers['cookie'] ?? ''
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ cookie: cookieHeader }))
      return
    }

    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/echo-cookies' })
      res.end()
      return
    }

    if (url.pathname === '/set-and-redirect') {
      res.writeHead(302, {
        'Set-Cookie': 'redirect_cookie=xyz; Path=/',
        Location: '/echo-cookies',
      })
      res.end()
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  // Handle HTTP upgrade requests (e.g. WebSocket) so onRequestUpgrade is reachable
  httpServer.on('upgrade', (_req, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        '\r\n',
    )
    socket.destroy()
  })

  httpServer.listen(0)
  await once(httpServer, 'listening')

  const address = httpServer.address() as { port: number }
  const port = address.port
  const baseUrl = `http://localhost:${port}`

  return {
    server: {
      port,
      baseUrl,
      close: () =>
        new Promise<void>((resolve, reject) => {
          httpServer.close((err) => (err ? reject(err) : resolve()))
        }),
    },
    requests,
  }
}

/**
 * Parse a cookie string into a key→value map.
 */
export function parseCookieString(cookieStr: string): Record<string, string> {
  return Object.fromEntries(
    cookieStr
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const eq = s.indexOf('=')
        return eq === -1 ? [s, ''] : [s.slice(0, eq).trim(), s.slice(eq + 1).trim()]
      }),
  )
}
