import { useState } from 'react'
import { useFixedMenu } from '../hooks/useFixedMenu'
import {
  guestChipLabel,
  guestEmailKey,
  isValidEmail,
  type CalendarGuest,
  type SavedCalendarUser,
} from '../lib/savedCalendarUsers'
import { FixedMenuPortal } from './FixedMenuPortal'

type CommitCalendarInviteProps = {
  calendarId: string
  summary: string
  checked: boolean
  busy?: boolean
  savedUsers: SavedCalendarUser[]
  guests: CalendarGuest[]
  lastGuests: CalendarGuest[]
  onToggle: (checked: boolean) => void
  onGuestsChange: (guests: CalendarGuest[]) => void
}

export function CommitCalendarInvite({
  calendarId,
  summary,
  checked,
  busy,
  savedUsers,
  guests,
  lastGuests,
  onToggle,
  onGuestsChange,
}: CommitCalendarInviteProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const menu = useFixedMenu({
    open: menuOpen,
    align: 'end',
    constrainHeight: true,
    onClose: () => setMenuOpen(false),
  })

  const invitedKeys = new Set(lastGuests.map((g) => guestEmailKey(g.email)))
  const invited = guests.filter((g) => invitedKeys.has(guestEmailKey(g.email)))
  const inviting = guests.filter((g) => !invitedKeys.has(guestEmailKey(g.email)))
  const selectedKeys = new Set(guests.map((g) => guestEmailKey(g.email)))

  function addGuest(email: string, name?: string) {
    const key = guestEmailKey(email)
    if (selectedKeys.has(key)) return
    const saved = savedUsers.find((user) => guestEmailKey(user.email) === key)
    onGuestsChange([
      ...guests,
      saved?.name.trim()
        ? { email: saved.email, name: saved.name.trim() }
        : name?.trim()
          ? { email, name: name.trim() }
          : { email },
    ])
  }

  function removeGuest(email: string) {
    const key = guestEmailKey(email)
    onGuestsChange(guests.filter((g) => guestEmailKey(g.email) !== key))
  }

  function toggleSaved(user: SavedCalendarUser) {
    const key = guestEmailKey(user.email)
    if (selectedKeys.has(key)) removeGuest(user.email)
    else addGuest(user.email, user.name)
  }

  function submitEmail(event: React.FormEvent) {
    event.preventDefault()
    const email = emailInput.trim()
    if (!isValidEmail(email)) {
      setEmailError('Enter a valid email.')
      return
    }
    addGuest(email)
    setEmailInput('')
    setEmailError(null)
  }

  return (
    <div className="commit-calendar-row" data-calendar-id={calendarId}>
      <div className="commit-calendar-row-main">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span>{summary}</span>
        </label>
        {checked && (
          <div className="commit-invite-menu">
            <button
              type="button"
              ref={menu.triggerRef}
              className="commit-invite-btn"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              disabled={busy}
              onClick={() => setMenuOpen((open) => !open)}
            >
              + Invite users
            </button>
            <FixedMenuPortal
              open={menuOpen}
              dropdownRef={menu.dropdownRef}
              style={menu.style}
              className="task-new-menu-dropdown commit-invite-dropdown is-over-modal"
            >
              {savedUsers.length === 0 ? (
                <p className="muted commit-invite-empty">
                  No saved users yet. Add some in Settings, or type an email.
                </p>
              ) : (
                savedUsers.map((user) => {
                  const selected = selectedKeys.has(guestEmailKey(user.email))
                  return (
                    <button
                      key={user.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={selected}
                      className={[
                        'calendar-menu-item',
                        selected ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        toggleSaved(user)
                        setMenuOpen(false)
                      }}
                    >
                      {user.name.trim() || user.email}
                    </button>
                  )
                })
              )}
              <form className="commit-invite-email" onSubmit={submitEmail}>
                <input
                  type="email"
                  value={emailInput}
                  placeholder="Email address"
                  aria-label="Invite by email"
                  onChange={(e) => {
                    setEmailInput(e.target.value)
                    setEmailError(null)
                  }}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Add
                </button>
              </form>
              {emailError && (
                <p className="commit-invite-error">{emailError}</p>
              )}
            </FixedMenuPortal>
          </div>
        )}
      </div>
      {checked && (invited.length > 0 || inviting.length > 0) && (
        <div className="commit-invite-chips">
          {invited.length > 0 && (
            <div className="commit-invite-chip-row">
              <span className="commit-invite-chip-label">Invited:</span>
              {invited.map((guest) => (
                <GuestChip
                  key={guestEmailKey(guest.email)}
                  guest={guest}
                  savedUsers={savedUsers}
                  disabled={busy}
                  onRemove={() => removeGuest(guest.email)}
                />
              ))}
            </div>
          )}
          {inviting.length > 0 && (
            <div className="commit-invite-chip-row">
              <span className="commit-invite-chip-label">Inviting:</span>
              {inviting.map((guest) => (
                <GuestChip
                  key={guestEmailKey(guest.email)}
                  guest={guest}
                  savedUsers={savedUsers}
                  disabled={busy}
                  onRemove={() => removeGuest(guest.email)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GuestChip({
  guest,
  savedUsers,
  disabled,
  onRemove,
}: {
  guest: CalendarGuest
  savedUsers: SavedCalendarUser[]
  disabled?: boolean
  onRemove: () => void
}) {
  const label = guestChipLabel(guest, savedUsers)
  return (
    <span className="commit-invite-chip">
      {label}
      <button
        type="button"
        className="commit-invite-chip-remove"
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  )
}
