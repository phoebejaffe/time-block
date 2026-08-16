import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AuthSessionDiagnostics } from './AuthSessionDiagnostics'
import { TrashIcon } from './icons'
import {
  guestEmailKey,
  isValidEmail,
  type SavedCalendarUser,
} from '../lib/savedCalendarUsers'
import type { GoogleCalendar } from '../lib/calendarApi'
import type { BlockLibrary, Plan } from '../lib/tasks'
import {
  migratePlan,
  normalizeBlockLibrary,
} from '../lib/tasks'
import {
  defaultPlanArchive,
  normalizePlanArchive,
  type PlanArchive,
} from '../lib/planArchive'
import type { SessionDiagnostics } from '../lib/google'
import type { UserSettings } from '../lib/userSettings'
import { normalizeUserSettings } from '../lib/userSettings'
import { TimeScrubInput } from './TimeScrubInput'

type SettingsSectionId =
  | 'planning'
  | 'calendar'
  | 'interface'
  | 'execution'
  | 'app'

type SettingsModalProps = {
  settings: UserSettings
  onChangeSettings: (next: UserSettings) => void
  targetCalendarId: string
  onTargetCalendarChange: (id: string) => void
  calendars: GoogleCalendar[]
  writableCalendars: GoogleCalendar[]
  savedUsers: SavedCalendarUser[]
  onChangeSavedUsers: (users: SavedCalendarUser[]) => void
  blockLibrary: BlockLibrary
  onReplaceBlockLibrary: (library: BlockLibrary) => void
  plan: Plan
  onReplacePlan: (plan: Plan) => void
  planArchive: PlanArchive
  onReplacePlanArchive: (archive: PlanArchive) => void
  onShowNotice?: (text: string) => void
  authDiagnostics?: SessionDiagnostics
  authSignedIn?: boolean
  authTestRefreshBusy?: boolean
  onAuthTestRefresh?: () => void
  onClose: () => void
}

const SECTIONS: { id: SettingsSectionId; label: string }[] = [
  { id: 'planning', label: 'Planning' },
  { id: 'calendar', label: 'Calendars' },
  { id: 'interface', label: 'Interface' },
  { id: 'execution', label: 'Running Plans' },
  { id: 'app', label: 'App' },
]

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)))
      } catch {
        reject(new Error('That file is not valid JSON.'))
      }
    }
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsText(file)
  })
}

export function SettingsModal({
  settings,
  onChangeSettings,
  targetCalendarId,
  onTargetCalendarChange,
  calendars,
  writableCalendars,
  savedUsers,
  onChangeSavedUsers,
  blockLibrary,
  onReplaceBlockLibrary,
  plan,
  onReplacePlan,
  planArchive,
  onReplacePlanArchive,
  onShowNotice,
  authDiagnostics,
  authSignedIn,
  authTestRefreshBusy,
  onAuthTestRefresh,
  onClose,
}: SettingsModalProps) {
  const [active, setActive] = useState<SettingsSectionId>('planning')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [addingUser, setAddingUser] = useState(false)
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const libraryFileRef = useRef<HTMLInputElement>(null)
  const plansFileRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  const hidden = useMemo(
    () => new Set(settings.hiddenCalendarIds),
    [settings.hiddenCalendarIds],
  )
  const libraryBlockCount = useMemo(
    () =>
      blockLibrary.categories.reduce((n, category) => n + category.blocks.length, 0),
    [blockLibrary.categories],
  )
  const archivedPlanCount = useMemo(
    () => planArchive.folders.reduce((n, folder) => n + folder.plans.length, 0),
    [planArchive.folders],
  )

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function patch(partial: Partial<UserSettings>) {
    onChangeSettings(normalizeUserSettings({ ...settings, ...partial }))
  }

  function addUser(event: React.FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName) {
      setPeopleError('Add a name.')
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      setPeopleError('Enter a valid email.')
      return
    }
    const key = guestEmailKey(trimmedEmail)
    if (savedUsers.some((user) => guestEmailKey(user.email) === key)) {
      setPeopleError('That email is already saved.')
      return
    }
    onChangeSavedUsers([
      ...savedUsers,
      { id: crypto.randomUUID(), name: trimmedName, email: trimmedEmail },
    ])
    setName('')
    setEmail('')
    setPeopleError(null)
    setAddingUser(false)
  }

  function removeUser(id: string) {
    onChangeSavedUsers(savedUsers.filter((user) => user.id !== id))
  }

  function toggleHiddenCalendar(id: string) {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    patch({ hiddenCalendarIds: [...next] })
  }

  async function importLibrary(file: File) {
    setDataError(null)
    try {
      const raw = await readJsonFile(file)
      const body =
        raw &&
        typeof raw === 'object' &&
        'blockLibrary' in (raw as object)
          ? (raw as { blockLibrary: unknown }).blockLibrary
          : raw
      const next = normalizeBlockLibrary(body)
      if (
        !window.confirm(
          'Replace your block library with this file? This cannot be undone from Settings.',
        )
      ) {
        return
      }
      onReplaceBlockLibrary(next)
      onShowNotice?.('Block library imported.')
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  async function importPlans(file: File) {
    setDataError(null)
    try {
      const raw = await readJsonFile(file)
      if (!raw || typeof raw !== 'object') {
        throw new Error('That file does not look like a plans export.')
      }
      const data = raw as {
        plan?: unknown
        planArchive?: unknown
      }
      const nextPlan = migratePlan(data.plan)
      if (!nextPlan) {
        throw new Error('Could not read Home plans from that file.')
      }
      const nextArchive =
        data.planArchive != null
          ? normalizePlanArchive(data.planArchive)
          : defaultPlanArchive()
      if (
        !window.confirm(
          'Replace Home plans and archived plans with this file? This cannot be undone from Settings.',
        )
      ) {
        return
      }
      onReplacePlan(nextPlan)
      onReplacePlanArchive(nextArchive)
      onShowNotice?.('Plans imported.')
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal-dialog modal-dialog-wide settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <h2 id={titleId}>Settings</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="settings-shell">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((section, index) => (
              <button
                key={section.id}
                type="button"
                className={[
                  'settings-nav-item',
                  active === section.id ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ animationDelay: `${index * 35}ms` }}
                onClick={() => setActive(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div className="settings-modal-body" key={active}>
            {active === 'planning' && (
              <section className="settings-section settings-section-enter">
                <h3 className="settings-section-title">New plans</h3>
                <p className="muted settings-section-hint">
                  Defaults for creating new plans.
                </p>
                <div className="settings-field-row">
                  <label className="settings-field">
                    <span>Anchor</span>
                    <select
                      value={settings.defaultAnchorKind}
                      onChange={(e) =>
                        patch({
                          defaultAnchorKind: e.target.value as 'start' | 'end',
                        })
                      }
                    >
                      <option value="end">Ends at</option>
                      <option value="start">Starts at</option>
                    </select>
                  </label>
                  <label className="settings-field">
                    <span>Time</span>
                    <TimeScrubInput
                      value={settings.defaultAnchorTime}
                      stepMinutes={settings.timeStepMinutes}
                      aria-label="Default plan time"
                      onChange={(hhmm) =>
                        patch({ defaultAnchorTime: hhmm || '09:00' })
                      }
                    />
                  </label>
                </div>
                <label className="settings-field">
                  <span>Length of custom blocks</span>
                  <div className="settings-inline-input">
                    <input
                      type="number"
                      min={1}
                      max={24 * 60}
                      value={settings.defaultBlockMinutes}
                      onChange={(e) =>
                        patch({
                          defaultBlockMinutes: Number(e.target.value) || 30,
                        })
                      }
                    />
                    <span className="muted">minutes</span>
                  </div>
                </label>
              </section>
            )}

            {active === 'calendar' && (
              <section className="settings-section settings-section-enter">
                <h3 className="settings-section-title">Saved users</h3>
                <p className="muted settings-section-hint">
                  People you can invite when adding a plan to your calendar.
                </p>
                {savedUsers.length === 0 && !addingUser ? (
                  <p className="muted settings-section-empty">
                    No saved users yet.
                  </p>
                ) : savedUsers.length > 0 ? (
                  <ul className="settings-saved-users">
                    {savedUsers.map((user) => (
                      <li key={user.id} className="settings-saved-user">
                        <div className="settings-saved-user-text">
                          <span className="settings-saved-user-name">
                            {user.name.trim() || 'Untitled'}
                          </span>
                          <span className="muted settings-saved-user-email">
                            {user.email}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remove ${user.name || user.email}`}
                          onClick={() => removeUser(user.id)}
                        >
                          <TrashIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {addingUser ? (
                  <form className="settings-saved-user-form" onSubmit={addUser}>
                    <label>
                      Name
                      <input
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value)
                          setPeopleError(null)
                        }}
                        autoComplete="name"
                        autoFocus
                      />
                    </label>
                    <label>
                      Email
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          setPeopleError(null)
                        }}
                        autoComplete="email"
                      />
                    </label>
                    <div className="settings-saved-user-form-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setAddingUser(false)
                          setName('')
                          setEmail('')
                          setPeopleError(null)
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary btn-sm">
                        Add
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="settings-text-link"
                    onClick={() => setAddingUser(true)}
                  >
                    Add user
                  </button>
                )}
                {peopleError && (
                  <p className="settings-section-error">{peopleError}</p>
                )}

                <h3 className="settings-section-title settings-section-title-spaced">
                  Default target calendar
                </h3>
                <p className="muted settings-section-hint">
                  When adding blocks to a calendar, this is the default.
                </p>
                <label className="settings-field">
                  <span className="sr-only">Default target calendar</span>
                  <select
                    value={
                      writableCalendars.some((c) => c.id === targetCalendarId)
                        ? targetCalendarId
                        : ''
                    }
                    onChange={(e) => onTargetCalendarChange(e.target.value)}
                    aria-label="Default target calendar"
                  >
                    <option value="">Primary / first writable</option>
                    {writableCalendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.summary}
                      </option>
                    ))}
                  </select>
                </label>

                <h3 className="settings-section-title settings-section-title-spaced">
                  Hide calendars
                </h3>
                <p className="muted settings-section-hint">
                  Applies across the entire app.
                </p>
                {calendars.length === 0 ? (
                  <p className="muted settings-section-empty">
                    Sign in to load your Google calendars.
                  </p>
                ) : (
                  <ul className="settings-calendar-list">
                    {calendars.map((cal) => (
                      <li key={cal.id} className="settings-calendar-row">
                        <label>
                          <input
                            type="checkbox"
                            checked={!hidden.has(cal.id)}
                            onChange={() => toggleHiddenCalendar(cal.id)}
                          />
                          <span
                            className="settings-calendar-swatch"
                            style={{
                              background: cal.backgroundColor || '#4285f4',
                            }}
                            aria-hidden
                          />
                          <span className="settings-calendar-name">
                            {cal.summary}
                            {cal.primary ? (
                              <span className="muted"> · primary</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {active === 'interface' && (
              <section className="settings-section settings-section-enter">
                <h3 className="settings-section-title">Time & duration step</h3>
                <p className="muted settings-section-hint">
                  Scrubbing and time inputs snap to this grid.
                </p>
                <label className="settings-field">
                  <span className="sr-only">Step size</span>
                  <select
                    value={settings.timeStepMinutes}
                    onChange={(e) =>
                      patch({
                        timeStepMinutes: Number(e.target.value) === 15 ? 15 : 5,
                      })
                    }
                    aria-label="Time and duration step"
                  >
                    <option value={5}>5 minutes</option>
                    <option value={15}>15 minutes</option>
                  </select>
                </label>

                <h3 className="settings-section-title settings-section-title-spaced">
                  Undo windows
                </h3>
                <p className="muted settings-section-hint">
                  How long the Undo action stays available — 0s disables undo.
                </p>
                <div className="settings-field-row">
                  <label className="settings-field">
                    <span>Quick undo</span>
                    <div className="settings-inline-input">
                      <input
                        type="number"
                        min={0}
                        max={120}
                        value={settings.quickUndoSeconds}
                        onChange={(e) =>
                          patch({
                            quickUndoSeconds: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <span className="muted">sec</span>
                    </div>
                    <span className="muted settings-field-note">
                      Blocks, delays, archive, stack moves
                    </span>
                  </label>
                  <label className="settings-field">
                    <span>Major undo</span>
                    <div className="settings-inline-input">
                      <input
                        type="number"
                        min={0}
                        max={300}
                        value={settings.majorUndoSeconds}
                        onChange={(e) =>
                          patch({
                            majorUndoSeconds: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <span className="muted">sec</span>
                    </div>
                    <span className="muted settings-field-note">
                      Plans, defaults, folders, categories
                    </span>
                  </label>
                </div>
              </section>
            )}

            {active === 'execution' && (
              <section className="settings-section settings-section-enter">
                <h3 className="settings-section-title">Run auto-end</h3>
                <p className="muted settings-section-hint">
                  After the last active block finishes, the running plan ends
                  automatically after this much time.
                </p>
                <label className="settings-field">
                  <span>Auto-end after</span>
                  <div className="settings-inline-input">
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={settings.executionAutoEndHours}
                      onChange={(e) =>
                        patch({
                          executionAutoEndHours: Number(e.target.value) || 2,
                        })
                      }
                    />
                    <span className="muted">hours</span>
                  </div>
                </label>
              </section>
            )}

            {active === 'app' && (
              <section className="settings-section settings-section-enter">
                <h3 className="settings-section-title">Export & import</h3>
                <p className="muted settings-section-hint">
                  Download JSON backups, or replace local synced data from a
                  file. Imports overwrite what you have now.
                </p>

                <div className="settings-data-card">
                  <div>
                    <strong>Block library</strong>
                    <p className="muted">
                      Categories and reusable blocks
                      {blockLibrary.categories.length === 0
                        ? ' — empty'
                        : ` — ${blockLibrary.categories.length} categor${
                            blockLibrary.categories.length === 1 ? 'y' : 'ies'
                          } · ${libraryBlockCount} block${
                            libraryBlockCount === 1 ? '' : 's'
                          }`}
                    </p>
                  </div>
                  <div className="settings-data-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        downloadJson('time-block-library.json', {
                          format: 'time-block-library',
                          version: 1,
                          exportedAt: new Date().toISOString(),
                          blockLibrary,
                        })
                        onShowNotice?.('Block library exported.')
                      }}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => libraryFileRef.current?.click()}
                    >
                      Import
                    </button>
                    <input
                      ref={libraryFileRef}
                      type="file"
                      accept="application/json,.json"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void importLibrary(file)
                      }}
                    />
                  </div>
                </div>

                <div className="settings-data-card">
                  <div>
                    <strong>Plans</strong>
                    <p className="muted">
                      Home plans plus archived plans
                      {` — ${plan.groups.length} plan${
                        plan.groups.length === 1 ? '' : 's'
                      } · ${archivedPlanCount} archived plan${
                        archivedPlanCount === 1 ? '' : 's'
                      }`}
                    </p>
                  </div>
                  <div className="settings-data-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        downloadJson('time-block-plans.json', {
                          format: 'time-block-plans',
                          version: 1,
                          exportedAt: new Date().toISOString(),
                          plan,
                          planArchive,
                        })
                        onShowNotice?.('Plans exported.')
                      }}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => plansFileRef.current?.click()}
                    >
                      Import
                    </button>
                    <input
                      ref={plansFileRef}
                      type="file"
                      accept="application/json,.json"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void importPlans(file)
                      }}
                    />
                  </div>
                </div>
                {dataError && (
                  <p className="settings-section-error">{dataError}</p>
                )}

                <h3 className="settings-section-title settings-section-title-spaced">
                  Session diagnostics
                </h3>
                <p className="muted settings-section-hint">
                  Token and scope details for debugging Google sign-in.
                </p>
                {authDiagnostics ? (
                  <AuthSessionDiagnostics
                    diagnostics={authDiagnostics}
                    signedIn={authSignedIn ?? false}
                    testBusy={authTestRefreshBusy}
                    onTestRefresh={onAuthTestRefresh}
                  />
                ) : (
                  <p className="muted settings-section-empty">
                    Diagnostics unavailable until Google auth has started.
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
