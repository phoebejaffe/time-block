import { describe, expect, it } from 'vitest'
import { isNotFoundError } from './calendarApi'

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
