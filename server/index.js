import { http } from '@google-cloud/functions-framework'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function applyCors(req, res) {
  const origin = req.get('origin')
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Vary', 'Origin')
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.set('Access-Control-Max-Age', '3600')
}

async function googleTokenRequest(params) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    ...params,
  })
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await resp.json().catch(() => ({}))
  return { ok: resp.ok, status: resp.status, data }
}

/**
 * Exchange a GIS popup auth code for tokens. The code client uses the
 * special 'postmessage' redirect for ux_mode: 'popup'.
 */
async function handleExchange(req, res) {
  const code = typeof req.body?.code === 'string' ? req.body.code : ''
  if (!code) {
    res.status(400).json({ error: 'missing_code' })
    return
  }

  const { ok, status, data } = await googleTokenRequest({
    code,
    redirect_uri: 'postmessage',
    grant_type: 'authorization_code',
  })

  if (!ok) {
    res.status(status === 400 ? 400 : 502).json({
      error: data.error || 'exchange_failed',
      error_description: data.error_description,
    })
    return
  }

  res.json({
    access_token: data.access_token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
    scope: data.scope,
  })
}

async function handleRefresh(req, res) {
  const refreshToken =
    typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : ''
  if (!refreshToken) {
    res.status(400).json({ error: 'missing_refresh_token' })
    return
  }

  const { ok, status, data } = await googleTokenRequest({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  if (!ok) {
    // invalid_grant → token revoked/expired; the client should sign in again.
    res.status(status === 400 ? 401 : 502).json({
      error: data.error || 'refresh_failed',
      error_description: data.error_description,
    })
    return
  }

  res.json({
    access_token: data.access_token,
    expires_in: data.expires_in,
    scope: data.scope,
  })
}

async function handleRevoke(req, res) {
  const token = typeof req.body?.token === 'string' ? req.body.token : ''
  if (token) {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {})
  }
  res.json({ ok: true })
}

http('auth', async (req, res) => {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: 'server_not_configured' })
    return
  }

  const path = (req.path || '/').replace(/\/+$/, '') || '/'
  try {
    if (path.endsWith('/exchange')) {
      await handleExchange(req, res)
    } else if (path.endsWith('/refresh')) {
      await handleRefresh(req, res)
    } else if (path.endsWith('/revoke')) {
      await handleRevoke(req, res)
    } else {
      res.status(404).json({ error: 'not_found' })
    }
  } catch (err) {
    console.error('auth function error:', err)
    res.status(500).json({ error: 'internal_error' })
  }
})
