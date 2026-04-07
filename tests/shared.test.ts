/**
 * Unit tests for the shared utility functions.
 */

import { describe, it, expect } from 'vitest'
import {
  buildUrl,
  injectCookieHeader,
  extractSetCookiesFromObject,
  persistCookies,
} from '../src/shared.js'
import { CookieJar } from 'tough-cookie'

// ---------------------------------------------------------------------------
// buildUrl
// ---------------------------------------------------------------------------

describe('buildUrl', () => {
  it('combines string origin and path', () => {
    const url = buildUrl({ origin: 'https://example.com', path: '/foo', method: 'GET' })
    expect(url).toBe('https://example.com/foo')
  })

  it('handles URL origin object', () => {
    const url = buildUrl({
      origin: new URL('https://example.com'),
      path: '/bar',
      method: 'GET',
    })
    expect(url).toBe('https://example.com/bar')
  })

  it('defaults path to / when missing', () => {
    const url = buildUrl({ origin: 'https://example.com', method: 'GET' })
    expect(url).toBe('https://example.com/')
  })

  it('preserves query strings', () => {
    const url = buildUrl({ origin: 'https://example.com', path: '/search?q=hello', method: 'GET' })
    expect(url).toBe('https://example.com/search?q=hello')
  })
})

// ---------------------------------------------------------------------------
// injectCookieHeader
// ---------------------------------------------------------------------------

describe('injectCookieHeader', () => {
  it('returns headers unchanged when cookie string is empty', () => {
    const headers = { 'x-custom': 'value' }
    expect(injectCookieHeader(headers, '')).toBe(headers)
  })

  it('adds cookie to undefined headers', () => {
    const result = injectCookieHeader(undefined, 'a=1')
    expect(result).toEqual({ cookie: 'a=1' })
  })

  it('adds cookie to null headers', () => {
    const result = injectCookieHeader(null, 'a=1')
    expect(result).toEqual({ cookie: 'a=1' })
  })

  it('adds cookie to empty object headers', () => {
    const result = injectCookieHeader({}, 'a=1')
    expect(result).toEqual({ cookie: 'a=1' })
  })

  it('merges with existing lowercase cookie key', () => {
    const result = injectCookieHeader({ cookie: 'existing=val' }, 'new=2') as Record<string, string>
    expect(result['cookie']).toBe('existing=val; new=2')
  })

  it('merges with existing uppercase Cookie key and normalises to lowercase', () => {
    const result = injectCookieHeader({ Cookie: 'existing=val' }, 'new=2') as Record<string, string>
    expect(result['cookie']).toBe('existing=val; new=2')
  })

  it('preserves other headers while adding cookie', () => {
    const result = injectCookieHeader(
      { 'x-auth': 'Bearer token', accept: 'application/json' },
      'sid=xyz',
    ) as Record<string, string>
    expect(result['cookie']).toBe('sid=xyz')
    expect(result['x-auth']).toBe('Bearer token')
    expect(result['accept']).toBe('application/json')
  })

  // Flat string array form
  it('adds cookie to flat string[] headers', () => {
    const result = injectCookieHeader(['x-foo', 'bar'], 'a=1') as string[]
    expect(result).toEqual(['x-foo', 'bar', 'cookie', 'a=1'])
  })

  it('merges with existing cookie in flat string[] headers', () => {
    const result = injectCookieHeader(['cookie', 'a=1', 'x-foo', 'bar'], 'b=2') as string[]
    expect(result[0]).toBe('cookie')
    expect(result[1]).toBe('a=1; b=2')
    expect(result[2]).toBe('x-foo')
    expect(result[3]).toBe('bar')
  })

  it('is case-insensitive for Cookie key in flat array', () => {
    const result = injectCookieHeader(['Cookie', 'a=1'], 'b=2') as string[]
    expect(result[1]).toBe('a=1; b=2')
  })
})

// ---------------------------------------------------------------------------
// extractSetCookiesFromObject
// ---------------------------------------------------------------------------

describe('extractSetCookiesFromObject', () => {
  it('returns empty array when no set-cookie header', () => {
    expect(extractSetCookiesFromObject({ 'content-type': 'application/json' })).toEqual([])
  })

  it('extracts single set-cookie string value', () => {
    const result = extractSetCookiesFromObject({ 'set-cookie': 'a=1; Path=/' })
    expect(result).toEqual(['a=1; Path=/'])
  })

  it('extracts multiple set-cookie array values', () => {
    const result = extractSetCookiesFromObject({
      'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
    })
    expect(result).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })

  it('is case-insensitive for header name', () => {
    const result = extractSetCookiesFromObject({ 'Set-Cookie': 'a=1' })
    expect(result).toEqual(['a=1'])
  })
})

// ---------------------------------------------------------------------------
// persistCookies
// ---------------------------------------------------------------------------

describe('persistCookies', () => {
  it('persists cookies into the jar', () => {
    const jar = new CookieJar()
    persistCookies(jar, 'https://example.com/', ['session=abc; Path=/'])
    const cookies = jar.getCookiesSync('https://example.com/')
    expect(cookies).toHaveLength(1)
    expect(cookies[0].key).toBe('session')
    expect(cookies[0].value).toBe('abc')
  })

  it('persists multiple cookies', () => {
    const jar = new CookieJar()
    persistCookies(jar, 'https://example.com/', ['a=1; Path=/', 'b=2; Path=/'])
    const cookies = jar.getCookiesSync('https://example.com/')
    expect(cookies).toHaveLength(2)
  })

  it('silently ignores malformed cookies', () => {
    const jar = new CookieJar()
    // Should not throw
    persistCookies(jar, 'https://example.com/', ['!!!invalid!!!'])
    const cookies = jar.getCookiesSync('https://example.com/')
    expect(cookies).toHaveLength(0)
  })
})
