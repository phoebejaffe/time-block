import { useState } from 'react'
import type { SessionDiagnostics } from '../lib/google'

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms <= 0) return 'expired'
  const totalSec = Math.round(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min >= 60) {
    const hr = Math.floor(min / 60)
    const remMin = min % 60
    return `${hr}h ${remMin}m`
  }
  if (min > 0) return `${min}m ${sec}s`
  return `${sec}s`
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(d)
}

function statusLabel(d: SessionDiagnostics, signedIn: boolean): string {
  if (signedIn) return 'Signed in'
  if (!d.restoreAttempted) return 'Checking session…'
  if (d.restoreSucceeded) return 'Signed in'
  if (d.hasStoredSession && d.hasRefreshToken) {
    return 'Session restore failed'
  }
  if (d.hasStoredSession) return 'Stored session incomplete'
  return 'Not signed in'
}

type AuthSessionDiagnosticsProps = {
  diagnostics: SessionDiagnostics
  signedIn: boolean
  testBusy?: boolean
  onTestRefresh?: () => void
  compact?: boolean
}

export function AuthSessionDiagnostics({
  diagnostics: d,
  signedIn,
  testBusy,
  onTestRefresh,
  compact = false,
}: AuthSessionDiagnosticsProps) {
  const [expanded, setExpanded] = useState(false)
  const status = statusLabel(d, signedIn)
  const willAutoRefresh =
    d.msUntilAccessExpiry != null &&
    d.msUntilAccessExpiry <= d.refreshBeforeExpiryMs
  const recoverLabel = d.canRecoverWithoutOauth
    ? 'Recover session'
    : 'Test refresh'
  return (
    <div
      className={[
        'auth-diagnostics',
        compact ? 'auth-diagnostics-compact' : '',
        d.canRecoverWithoutOauth ? 'auth-diagnostics-recoverable' : '',
        expanded ? 'is-expanded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="auth-diagnostics-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="auth-diagnostics-title">Session diagnostics</span>
        <span className="auth-diagnostics-chevron" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="auth-diagnostics-body">
          {d.canRecoverWithoutOauth && (
            <p className="auth-diagnostics-banner">
              Your refresh token is still saved. Silent restore failed (often a
              cold backend after a day away) — try{' '}
              <strong>{recoverLabel}</strong> before doing full Google sign-in
              again.
            </p>
          )}
          <dl className="auth-diagnostics-list">
            <div>
              <dt>Status</dt>
              <dd>{status}</dd>
            </div>
            {!signedIn && d.restoreDetail && (
              <div>
                <dt>Why</dt>
                <dd>{d.restoreDetail}</dd>
              </div>
            )}
            {signedIn && d.restoreDetail && (
              <div>
                <dt>On reopen</dt>
                <dd>{d.restoreDetail}</dd>
              </div>
            )}
            <div>
              <dt>Refresh token</dt>
              <dd>
                {d.hasRefreshToken ? 'present (saved in browser)' : 'missing'}
              </dd>
            </div>
            <div>
              <dt>Access token</dt>
              <dd>
                {d.hasAccessToken
                  ? `valid for ${formatDuration(d.msUntilAccessExpiry)}`
                  : 'none active'}
              </dd>
            </div>
            <div>
              <dt>While tab open</dt>
              <dd>
                {d.refreshLoopActive
                  ? willAutoRefresh
                    ? 'refreshing now (≤5 min left)'
                    : `checks every ${Math.round(d.refreshCheckIntervalMs / 1000)}s`
                  : 'not running'}
              </dd>
            </div>
            <div>
              <dt>When app closed</dt>
              <dd>
                Refresh token stays in this browser. Reopening should call
                /refresh automatically (with retries if the backend is cold).
              </dd>
            </div>
            <div>
              <dt>Last /refresh</dt>
              <dd>
                {d.lastRefreshAt ? (
                  <>
                    {formatWhen(d.lastRefreshAt)}
                    {d.lastRefreshSource ? ` (${d.lastRefreshSource})` : ''}
                    {' — '}
                    {d.lastRefreshOk ? (
                      <span className="auth-diagnostics-ok">ok</span>
                    ) : (
                      <span className="auth-diagnostics-err">failed</span>
                    )}
                    {d.lastRefreshMs != null ? ` in ${d.lastRefreshMs}ms` : ''}
                  </>
                ) : (
                  'none yet — use the button below'
                )}
              </dd>
            </div>
            {d.lastRefreshError && (
              <div>
                <dt>Refresh error</dt>
                <dd className="auth-diagnostics-err">{d.lastRefreshError}</dd>
              </div>
            )}
            {!compact && (
              <div>
                <dt>Backend</dt>
                <dd className="auth-diagnostics-mono">{d.authEndpoint}</dd>
              </div>
            )}
          </dl>
          {!compact && (
            <p className="auth-diagnostics-hint muted">
              After a day away, a failed reopen is usually a cold Cloud Function
              — not an expired Google login. The app retries automatically;{' '}
              <strong>{recoverLabel}</strong> does the same call without the
              Google consent popup.
            </p>
          )}
          {compact && (
            <p className="auth-diagnostics-hint muted">
              Reopening refreshes silently (with retries). Full Google consent
              is only needed if the refresh token is gone or rejected.
            </p>
          )}
          {onTestRefresh && (
            <button
              type="button"
              className={[
                'btn',
                'btn-sm',
                'auth-diagnostics-test',
                d.canRecoverWithoutOauth ? 'btn-primary' : 'btn-ghost',
              ].join(' ')}
              disabled={testBusy || !d.hasRefreshToken}
              onClick={onTestRefresh}
              title={
                d.hasRefreshToken
                  ? 'Call the auth backend /refresh endpoint now'
                  : 'Sign in first to obtain a refresh token'
              }
            >
              {testBusy ? 'Refreshing…' : recoverLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
