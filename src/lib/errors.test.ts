import { describe, expect, it } from 'vitest'
import { formatError } from './errors'

describe('formatError', () => {
  it('reads common gapi error shapes', () => {
    expect(
      formatError({
        result: {
          error: {
            code: 403,
            message: 'Request had insufficient authentication scopes.',
            status: 'PERMISSION_DENIED',
          },
        },
        status: 403,
      }),
    ).toBe(
      'Request had insufficient authentication scopes. (PERMISSION_DENIED)',
    )

    expect(
      formatError({
        error: { code: 404, message: 'Not Found' },
      }),
    ).toBe('Not Found (404)')
  })

  it('does not return [object Object] for plain objects', () => {
    const text = formatError({ foo: 'bar', nested: { a: 1 } })
    expect(text).not.toContain('[object Object]')
    expect(text).toContain('foo')
  })

  it('unwraps Error causes and JSON message strings', () => {
    expect(formatError(new Error('plain failure'))).toBe('plain failure')
    expect(
      formatError(
        new Error(
          JSON.stringify({
            error: { message: 'Quota exceeded', code: 429 },
          }),
        ),
      ),
    ).toBe('Quota exceeded (429)')

    const caused = new Error('[object Object]')
    caused.cause = { result: { error: { message: 'Backend Error', code: 500 } } }
    expect(formatError(caused)).toBe('Backend Error (500)')
  })

  it('handles GIS-style token errors', () => {
    expect(
      formatError({
        error: 'access_denied',
        error_description: 'User denied access',
      }),
    ).toBe('User denied access')
  })
})
