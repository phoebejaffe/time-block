import type { GoogleCalendar } from '../lib/calendarApi'

type CalendarTogglesProps = {
  calendars: GoogleCalendar[]
  visibleIds: Set<string>
  onToggle: (calendarId: string) => void
  disabled?: boolean
}

export function CalendarToggles({
  calendars,
  visibleIds,
  onToggle,
  disabled,
}: CalendarTogglesProps) {
  if (calendars.length === 0) {
    return <p className="muted">No calendars loaded yet.</p>
  }

  return (
    <ul className="calendar-toggles">
      {calendars.map((cal) => (
        <li key={cal.id}>
          <label className="calendar-toggle">
            <input
              type="checkbox"
              checked={visibleIds.has(cal.id)}
              onChange={() => onToggle(cal.id)}
              disabled={disabled}
            />
            <span
              className="calendar-swatch"
              style={{ background: cal.backgroundColor }}
              aria-hidden
            />
            <span className="calendar-name">{cal.summary}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}
