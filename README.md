# undici-cookie-agent

[![CI](https://github.com/eXhumer/undici-cookie-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/eXhumer/undici-cookie-agent/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/eXhumer/undici-cookie-agent/branch/main/graph/badge.svg)](https://codecov.io/gh/eXhumer/undici-cookie-agent)
[![npm](https://img.shields.io/npm/v/@exhumer/undici-cookie-agent)](https://www.npmjs.com/package/@exhumer/undici-cookie-agent)

Cookie jar support for [undici](https://github.com/nodejs/undici) v7 and v8, powered by [tough-cookie](https://github.com/salesforce/tough-cookie).

Automatically stores `Set-Cookie` headers from responses and sends the appropriate `Cookie` header on subsequent requests - with no changes to your existing undici setup beyond swapping in an agent.

## Requirements

- Node.js 20+
- `undici` ≥ 7.0.0 (peer dependency)
- `tough-cookie` ≥ 6.0.0 (peer dependency)

## Installation

```sh
npm install @exhumer/undici-cookie-agent tough-cookie
```

## Usage

There are three ways to add cookie support, depending on how you use undici.

### `CookieAgent`

A drop-in replacement for `undici.Agent`. Pass it as the `dispatcher` to `request`, `fetch`, or any other undici method.

```ts
import { fetch, request } from 'undici'
import { CookieJar } from 'tough-cookie'
import { CookieAgent } from '@exhumer/undici-cookie-agent'

const jar = new CookieJar()
const agent = new CookieAgent({ cookies: { jar } })

// Cookies set by this response are stored in the jar...
await request('https://example.com/login', { dispatcher: agent })

// ...and sent automatically on the next request
await request('https://example.com/profile', { dispatcher: agent })

// Works with undici's fetch too
const res = await fetch('https://example.com/api', { dispatcher: agent })
```

All standard `Agent` options are supported alongside `cookies`:

```ts
const agent = new CookieAgent({
  cookies: { jar },
  keepAliveTimeout: 10_000,
  connections: 10,
})
```

### `cookie()` interceptor

If you already have an agent and want to layer cookie handling on top without subclassing, use the `cookie()` interceptor with `dispatcher.compose()`.

```ts
import { Agent, ProxyAgent, request } from 'undici'
import { CookieJar } from 'tough-cookie'
import { cookie } from '@exhumer/undici-cookie-agent'

const jar = new CookieJar()

// With a plain Agent
const agent = new Agent().compose(cookie({ cookies: { jar } }))

// Or composed on top of a ProxyAgent
const proxied = new ProxyAgent('http://proxy:8080').compose(cookie({ cookies: { jar } }))

await request('https://example.com/', { dispatcher: agent })
```

Multiple interceptors can be chained:

```ts
const agent = new Agent().compose(
  cookie({ cookies: { jar } }),
  myOtherInterceptor,
)
```

### `createCookieAgent()` mixin

Wraps any `Agent` subclass with cookie handling - useful when you need to extend a third-party agent class.

```ts
import { ProxyAgent } from 'undici'
import { CookieJar } from 'tough-cookie'
import { createCookieAgent } from '@exhumer/undici-cookie-agent'

const CookieProxyAgent = createCookieAgent(ProxyAgent)

const jar = new CookieJar()
const agent = new CookieProxyAgent('http://proxy:8080', { cookies: { jar } })
```

The mixin looks for `{ cookies: { jar } }` in the constructor arguments. If it isn't found, a `TypeError` is thrown at construction time.

## How it works

undici dispatches requests through a handler chain. `undici-cookie-agent` wraps your handler to intercept two points in the lifecycle:

- **Before the request is sent** - calls `jar.getCookieStringSync(url)` and injects the result as a `Cookie` header, merging with any cookie header you've set manually.
- **When response headers arrive** - extracts all `Set-Cookie` headers and calls `jar.setCookieSync()` for each one. Malformed cookies are silently ignored so they never crash a request.

The agent handles all three header shapes undici accepts on `DispatchOptions` - object, flat `string[]` pair array, `null`, and `undefined`.

## API

### `new CookieAgent(options)`

Extends `undici.Agent`. Accepts all standard `Agent.Options` plus:

| Option | Type | Description |
|---|---|---|
| `cookies.jar` | `CookieJar` | The tough-cookie jar to read from and write to |

### `cookie(options)`

Returns a `Dispatcher.DispatcherComposeInterceptor` for use with `dispatcher.compose()`.

| Option | Type | Description |
|---|---|---|
| `cookies.jar` | `CookieJar` | The tough-cookie jar to read from and write to |

### `createCookieAgent(Base)`

Takes any class that extends `undici.Agent` and returns a new class with cookie support mixed in. The returned class accepts `{ cookies: { jar } }` in its constructor arguments.

## License

MIT
