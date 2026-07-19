/**
 * Turn thrown values (especially Google / gapi error objects) into a short
 * human-readable string. Avoids the useless "[object Object]" fallback.
 */
export function formatError(err: unknown): string {
  if (err == null) return 'Unknown error'

  if (typeof err === 'string') {
    const trimmed = err.trim()
    if (!trimmed || trimmed === '[object Object]') return 'Unknown error'
    return parseEmbeddedJsonMessage(trimmed) ?? trimmed
  }

  if (typeof err === 'number' || typeof err === 'boolean') {
    return String(err)
  }

  if (typeof err !== 'object') return 'Unknown error'

  // Prefer Error.message / cause before treating the instance as a gapi bag.
  if (err instanceof Error) {
    const msg = err.message?.trim()
    if (msg && msg !== '[object Object]') {
      return parseEmbeddedJsonMessage(msg) ?? msg
    }
    if (err.cause != null) {
      const nested = formatError(err.cause)
      if (nested !== 'Unknown error') return nested
    }
  }

  const fromGoogle = googleErrorMessage(err)
  if (fromGoogle) return fromGoogle

  const record = err as Record<string, unknown>
  if (
    typeof record.error_description === 'string' &&
    record.error_description.trim()
  ) {
    return record.error_description.trim()
  }
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim()
  }
  if (typeof record.body === 'string' && record.body.trim()) {
    return (
      parseEmbeddedJsonMessage(record.body) ??
      record.body.trim().slice(0, 280)
    )
  }

  const status = record.status ?? record.statusCode
  const statusText =
    typeof record.statusText === 'string' ? record.statusText.trim() : ''
  if (typeof status === 'number') {
    return statusText ? `HTTP ${status}: ${statusText}` : `HTTP ${status}`
  }

  try {
    const json = JSON.stringify(err)
    if (json && json !== '{}' && json !== 'null') {
      return json.length > 280 ? `${json.slice(0, 277)}…` : json
    }
  } catch {
    /* circular */
  }

  return 'Unknown error'
}

function asMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === '[object Object]') return null
  return trimmed
}

function googleErrorMessage(err: object): string | null {
  const e = err as {
    message?: unknown
    body?: unknown
    status?: unknown
    statusCode?: unknown
    error?: {
      message?: unknown
      code?: unknown
      status?: unknown
      errors?: Array<{ message?: unknown; reason?: unknown }>
    }
    result?: {
      error?: {
        message?: unknown
        code?: unknown
        status?: unknown
        errors?: Array<{ message?: unknown; reason?: unknown }>
      }
    }
  }

  const google =
    e.result?.error ??
    (e.error && typeof e.error === 'object' ? e.error : undefined)

  const message =
    asMessage(google?.message) ??
    asMessage(e.message) ??
    asMessage(google?.errors?.[0]?.message)

  if (!message) {
    if (typeof e.body === 'string') {
      return parseEmbeddedJsonMessage(e.body)
    }
    return null
  }

  const code = google?.code ?? e.status ?? e.statusCode
  const status = asMessage(google?.status)
  if (status && !message.includes(status)) {
    return `${message} (${status})`
  }
  if (typeof code === 'number' && !message.includes(String(code))) {
    return `${message} (${code})`
  }
  return message
}

/** If a string looks like JSON with an error.message, prefer that. */
function parseEmbeddedJsonMessage(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') return null
    return googleErrorMessage(parsed) ?? formatError(parsed)
  } catch {
    return null
  }
}
