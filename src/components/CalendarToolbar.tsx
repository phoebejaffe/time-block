import type { RefObject } from 'react'
import type { GoogleCalendar } from '../lib/calendarApi'
import { CalendarToggles } from './CalendarToggles'

export type CalendarViewType = 'timeGridDay' | 'timeGridThreeDay' | 'timeGridWeek'

type CalendarToolbarProps = {
  title: string
  isOnToday: boolean
  farFromTodayOrTomorrow: boolean
  viewType: CalendarViewType
  narrow: boolean
  showAllDay: boolean
  menuOpen: boolean
  calendarsOpen: boolean
  calendars: GoogleCalendar[]
  visibleCalendarIds: Set<string>
  busy?: boolean
  menuRef: RefObject<HTMLDivElement | null>
  calendarsMenuRef: RefObject<HTMLDivElement | null>
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onToggleMenu: () => void
  onToggleCalendars: () => void
  onToggleAllDay: () => void
  onChangeView: (view: CalendarViewType) => void
  onToggleCalendar: (calendarId: string) => void
}

export function CalendarToolbar({
  title,
  isOnToday,
  farFromTodayOrTomorrow,
  viewType,
  narrow,
  showAllDay,
  menuOpen,
  calendarsOpen,
  calendars,
  visibleCalendarIds,
  busy,
  menuRef,
  calendarsMenuRef,
  onPrev,
  onNext,
  onToday,
  onToggleMenu,
  onToggleCalendars,
  onToggleAllDay,
  onChangeView,
  onToggleCalendar,
}: CalendarToolbarProps) {
  return (
    <div className="calendar-toolbar">
      <div className="calendar-toolbar-side calendar-toolbar-left">
        <div className="calendar-nav">
          <button
            type="button"
            className="btn btn-ghost btn-icon calendar-nav-btn"
            aria-label="Previous"
            onClick={onPrev}
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon calendar-nav-btn"
            aria-label="Next"
            onClick={onNext}
          >
            <ChevronIcon direction="right" />
          </button>
          {!isOnToday && (
            <button
              type="button"
              className="btn btn-ghost btn-icon calendar-today-btn"
              aria-label="Today"
              title="Today"
              onClick={onToday}
            >
              <TodayIcon />
            </button>
          )}
        </div>
      </div>

      <div className="calendar-toolbar-center">
        <h2 className="calendar-title">{title}</h2>
        {farFromTodayOrTomorrow && (
          <span
            className="calendar-date-warning"
            title="Not today or tomorrow"
            aria-label="Not today or tomorrow"
            role="img"
          >
            <WarningIcon />
          </span>
        )}
      </div>

      <div className="calendar-toolbar-side calendar-toolbar-right">
        <div className="calendar-toolbar-menus">
          <div className="calendars-menu" ref={calendarsMenuRef}>
            <button
              type="button"
              className="btn btn-text btn-icon"
              aria-label="Calendars"
              aria-expanded={calendarsOpen}
              aria-haspopup="true"
              title="Calendars"
              onClick={onToggleCalendars}
            >
              <CalendarIcon />
            </button>
            {calendarsOpen && (
              <div className="calendars-dropdown" role="menu">
                <CalendarToggles
                  calendars={calendars}
                  visibleIds={visibleCalendarIds}
                  onToggle={onToggleCalendar}
                  disabled={busy}
                />
              </div>
            )}
          </div>

          <div className="calendar-menu" ref={menuRef}>
            <button
              type="button"
              className="btn btn-text btn-icon"
              aria-label="Calendar options"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              onClick={onToggleMenu}
            >
              ···
            </button>
            {menuOpen && (
              <div className="calendar-menu-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={showAllDay}
                  className="calendar-menu-item"
                  onClick={onToggleAllDay}
                >
                  {showAllDay ? 'Hide all-day events' : 'Show all-day events'}
                </button>
                <div className="calendar-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={viewType === 'timeGridDay'}
                  className={[
                    'calendar-menu-item',
                    viewType === 'timeGridDay' ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onChangeView('timeGridDay')}
                >
                  Day
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={viewType === 'timeGridThreeDay'}
                  className={[
                    'calendar-menu-item',
                    viewType === 'timeGridThreeDay' ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onChangeView('timeGridThreeDay')}
                >
                  3 Day
                </button>
                {!narrow && (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={viewType === 'timeGridWeek'}
                    className={[
                      'calendar-menu-item',
                      viewType === 'timeGridWeek' ? 'is-active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onChangeView('timeGridWeek')}
                  >
                    Week
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WarningIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 9H21M17 13.0014L7 13M10.3333 17.0005L7 17M7 3V5M17 3V5M6.2 21H17.8C18.9201 21 19.4802 21 19.908 20.782C20.2843 20.5903 20.5903 20.2843 20.782 19.908C21 19.4802 21 18.9201 21 17.8V8.2C21 7.07989 21 6.51984 20.782 6.09202C20.5903 5.71569 20.2843 5.40973 19.908 5.21799C19.4802 5 18.9201 5 17.8 5H6.2C5.0799 5 4.51984 5 4.09202 5.21799C3.71569 5.40973 3.40973 5.71569 3.21799 6.09202C3 6.51984 3 7.07989 3 8.2V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.07989 21 6.2 21Z"
        stroke="#5c6b63"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {direction === 'left' ? (
        <path d="m15 18-6-6 6-6" />
      ) : (
        <path d="m9 18 6-6-6-6" />
      )}
    </svg>
  )
}

function TodayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
