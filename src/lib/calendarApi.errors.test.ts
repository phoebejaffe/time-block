import { describe, expect, it } from 'vitest'
import { isAuthError, isNotFoundError } from './calendarApi'

describe('isNotFoundError', () => {
  it('detects common gapi / Google error shapes', () => {
    expect(isNotFoundError({ status: 404 })).toBe(true)
    expect(isNotFoundError({ status: 410 })).toBe(true)
    expect(
      isNotFoundError({ result: { error: { code: 404, message: 'Not Found' } } }),
    ).toBe(true)
    expect(
      isNotFoundError({
        error: {
          code: 404,
          errors: [{ reason: 'notFound' }],
        },
      }),
    ).toBe(true)
    expect(isNotFoundError('Not Found')).toBe(true)
    expect(isNotFoundError({ status: 403 })).toBe(false)
    expect(isNotFoundError({ result: { error: { code: 500 } } })).toBe(false)
  })
})

describe('isAuthError', () => {
  it('detects common gapi / Google auth error shapes', () => {
    expect(isAuthError({ status: 401 })).toBe(true)
    expect(
      isAuthError({
        result: {
          error: {
            code: 401,
            status: 'UNAUTHENTICATED',
            message: 'Request had invalid authentication credentials.',
          },
        },
      }),
    ).toBe(true)
    expect(
      isAuthError({ error: { code: 401, errors: [{ reason: 'authError' }] } }),
    ).toBe(true)
    expect(
      isAuthError({ result: { error: { status: 'UNAUTHENTICATED' } } }),
    ).toBe(true)
    expect(isAuthError('Invalid Credentials')).toBe(true)
    expect(isAuthError({ body: '{"error": {"code": 401}}' })).toBe(true)
    expect(isAuthError({ status: 403 })).toBe(false)
    expect(isAuthError({ status: 404 })).toBe(false)
    expect(isAuthError({ result: { error: { code: 500 } } })).toBe(false)
    expect(isAuthError('quota exceeded')).toBe(false)
    expect(isAuthError(null)).toBe(false)
  })
})
