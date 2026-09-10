import { describe, expect, it } from 'vitest'
import { sanitizePostLoginRedirect } from './redirects'

describe('sanitizePostLoginRedirect', () => {
  it('keeps an internal ERP destination including search and hash', () => {
    expect(sanitizePostLoginRedirect('/shops?status=active#shop-1')).toBe(
      '/shops?status=active#shop-1',
    )
  })

  it.each([
    undefined,
    null,
    '',
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/login',
    '/login?redirect=%2Fshops',
    '/login/nested',
  ])('rejects unsafe or recursive login destination %s', (value) => {
    expect(sanitizePostLoginRedirect(value)).toBeUndefined()
  })
})
