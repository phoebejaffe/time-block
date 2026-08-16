import { useEffect, useState } from 'react'
import { TrashIcon } from './icons'
import {
  guestEmailKey,
  isValidEmail,
  type SavedCalendarUser,
} from '../lib/savedCalendarUsers'

type SettingsModalProps = {
  savedUsers: SavedCalendarUser[]
  onChange: (users: SavedCalendarUser[]) => void
  onClose: () => void
}

export function SettingsModal({
  savedUsers,
  onChange,
  onClose,
}: SettingsModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function addUser(event: React.FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName) {
      setError('Add a name.')
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      setError('Enter a valid email.')
      return
    }
    const key = guestEmailKey(trimmedEmail)
    if (savedUsers.some((user) => guestEmailKey(user.email) === key)) {
      setError('That email is already saved.')
      return
    }
    onChange([
      ...savedUsers,
      { id: crypto.randomUUID(), name: trimmedName, email: trimmedEmail },
    ])
    setName('')
    setEmail('')
    setError(null)
  }

  function removeUser(id: string) {
    onChange(savedUsers.filter((user) => user.id !== id))
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
        aria-label="Settings"
      >
        <div className="modal-header">
          <h2>Settings</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Saved users</h3>
            <p className="muted settings-section-hint">
              People you can invite when adding a plan to your calendar.
            </p>
            {savedUsers.length === 0 ? (
              <p className="muted settings-section-empty">No saved users yet.</p>
            ) : (
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
            )}
            <form className="settings-saved-user-form" onSubmit={addUser}>
              <label>
                Name
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setError(null)
                  }}
                  autoComplete="name"
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError(null)
                  }}
                  autoComplete="email"
                />
              </label>
              <button type="submit" className="btn btn-primary btn-sm">
                Add
              </button>
            </form>
            {error && <p className="settings-section-error">{error}</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
