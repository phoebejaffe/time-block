import { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  FormatterInput,
} from '@fullcalendar/core'
import type {
  EventDragStartArg,
  EventDragStopArg,
  EventResizeDoneArg,
} from '@fullcalendar/interaction'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { CalendarEvent, GoogleCalendar } from '../lib/calendarApi'
import type { StackAnchor, Task } from '../lib/tasks'
import { resolveStack } from '../lib/tasks'
import { CalendarToggles } from './CalendarToggles'

const TASK_COLOR = '#0f6e56'
const TASK_BORDER = '#0b5341'
const NARROW_BREAKPOINT = 560

const TITLE_FORMAT: FormatterInput = {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}

type CalendarViewType = 'timeGridDay' | 'timeGridThreeDay' | 'timeGridWeek'

type CalendarViewProps = {
  googleEvents: CalendarEvent[]
  calendars: GoogleCalendar[]
  visibleCalendarIds: Set<string>
  onToggleCalendar: (calendarId: string) => void
  tasks: Task[]
  anchor: StackAnchor
  onDatesSet: (start: Date, end: Date) => void
  onStackShift: (deltaMs: number) => void
  onTaskDurationChange: (taskId: string, durationMinutes: number) => void
  onSelectSlot?: (start: Date, end: Date) => void
  onTaskClick?: (taskId: string) => void
  busy?: boolean
}

const TASK_STACK_CLASS = 'task-event'
const CAL_ZOOM_MIN = 0.7
const CAL_ZOOM_MAX = 2.5

type StackDragState = {
  taskId: string
  subjectEl: HTMLElement
  originTop: number
  originLeft: number
}

function clampZoom(value: number): number {
  return Math.min(CAL_ZOOM_MAX, Math.max(CAL_ZOOM_MIN, value))
}

function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.hypot(dx, dy)
}

export function CalendarView({
  googleEvents,
  calendars,
  visibleCalendarIds,
  onToggleCalendar,
  tasks,
  anchor,
  onDatesSet,
  onStackShift,
  onTaskDurationChange,
  onSelectSlot,
  onTaskClick,
  busy,
}: CalendarViewProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const calendarBodyRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const calendarsMenuRef = useRef<HTMLDivElement>(null)
  const stackDragRef = useRef<StackDragState | null>(null)
  const stackDragRafRef = useRef<number | null>(null)
  const zoomRef = useRef(1)
  const pinchRef = useRef<{
    startDistance: number
    startZoom: number
  } | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [title, setTitle] = useState('')
  const [viewType, setViewType] = useState<CalendarViewType>('timeGridDay')
  const [showAllDay, setShowAllDay] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [calendarsOpen, setCalendarsOpen] = useState(false)
  const [isOnToday, setIsOnToday] = useState(true)
  const [zoom, setZoom] = useState(1)

  function clearStackDragTransforms() {
    shellRef.current
      ?.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`)
      .forEach((el) => {
        el.style.transform = ''
      })
  }

  function stopStackDragTracking() {
    stackDragRef.current = null
    if (stackDragRafRef.current !== null) {
      cancelAnimationFrame(stackDragRafRef.current)
      stackDragRafRef.current = null
    }
  }

  function syncStackDragTransforms() {
    const shell = shellRef.current
    const drag = stackDragRef.current
    if (!shell || !drag) return

    const mirror = shell.querySelector<HTMLElement>('.fc-event-mirror')
    if (!mirror) return

    const rect = mirror.getBoundingClientRect()
    const deltaX = rect.left - drag.originLeft
    const deltaY = rect.top - drag.originTop
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      clearStackDragTransforms()
      return
    }

    shell.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`).forEach((el) => {
      if (el.classList.contains('fc-event-mirror') || el === drag.subjectEl) return
      el.style.transform = `translate(${deltaX}px, ${deltaY}px)`
    })
  }

  useEffect(() => {
    zoomRef.current = zoom
    calendarRef.current?.getApi().updateSize()
  }, [zoom])

  useEffect(() => {
    return () => {
      stopStackDragTracking()
      clearStackDragTransforms()
    }
  }, [])

  useEffect(() => {
    function preventPageGesture(event: Event) {
      event.preventDefault()
    }
    // Safari page-level pinch zoom gestures.
    document.addEventListener('gesturestart', preventPageGesture, {
      passive: false,
    })
    document.addEventListener('gesturechange', preventPageGesture, {
      passive: false,
    })
    document.addEventListener('gestureend', preventPageGesture, {
      passive: false,
    })
    return () => {
      document.removeEventListener('gesturestart', preventPageGesture)
      document.removeEventListener('gesturechange', preventPageGesture)
      document.removeEventListener('gestureend', preventPageGesture)
    }
  }, [])

  useEffect(() => {
    const el = calendarBodyRef.current
    if (!el) return

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 2) {
        pinchRef.current = null
        return
      }
      pinchRef.current = {
        startDistance: touchDistance(event.touches[0]!, event.touches[1]!),
        startZoom: zoomRef.current,
      }
    }

    function onTouchMove(event: TouchEvent) {
      const pinch = pinchRef.current
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const distance = touchDistance(event.touches[0]!, event.touches[1]!)
      if (pinch.startDistance <= 0) return
      const next = clampZoom(
        pinch.startZoom * (distance / pinch.startDistance),
      )
      setZoom(next)
    }

    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinchRef.current = null
    }

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.01)
      setZoom((prev) => clampZoom(prev * factor))
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  useEffect(() => {
    const el = shellRef.current
    if (!el) return

    const update = (width: number) => {
      setNarrow(width < NARROW_BREAKPOINT)
    }

    update(el.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width === 'number') update(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!narrow) return
    if (viewType !== 'timeGridWeek') return
    const api = calendarRef.current?.getApi()
    api?.changeView('timeGridThreeDay')
    setViewType('timeGridThreeDay')
  }, [narrow, viewType])

  useEffect(() => {
    if (!menuOpen && !calendarsOpen) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false)
      }
      if (
        calendarsOpen &&
        calendarsMenuRef.current &&
        !calendarsMenuRef.current.contains(target)
      ) {
        setCalendarsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      setCalendarsOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen, calendarsOpen])

  const events = useMemo((): EventInput[] => {
    const google: EventInput[] = googleEvents
      .filter((e) => showAllDay || !e.allDay)
      .map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        backgroundColor: e.backgroundColor,
        borderColor: e.borderColor,
        editable: false,
        order: 1,
        extendedProps: e.extendedProps,
      }))

    const local: EventInput[] = resolveStack(tasks, anchor).map((task) => ({
      id: `task:${task.id}`,
      title: task.title,
      start: task.start.toISOString(),
      end: task.end.toISOString(),
      backgroundColor: TASK_COLOR,
      borderColor: TASK_BORDER,
      editable: true,
      order: 0,
      classNames: [TASK_STACK_CLASS],
      extendedProps: {
        source: 'task',
        taskId: task.id,
      },
    }))

    return [...google, ...local]
  }, [googleEvents, tasks, anchor, showAllDay])

  function handleDatesSet(arg: DatesSetArg) {
    setTitle(arg.view.title)
    const type = arg.view.type
    if (
      type === 'timeGridDay' ||
      type === 'timeGridThreeDay' ||
      type === 'timeGridWeek'
    ) {
      setViewType(type)
    }
    const now = new Date()
    setIsOnToday(now >= arg.start && now < arg.end)
    onDatesSet(arg.start, arg.end)
  }

  function changeView(next: CalendarViewType) {
    calendarRef.current?.getApi().changeView(next)
    setViewType(next)
    setMenuOpen(false)
  }

  function goToday() {
    calendarRef.current?.getApi().today()
  }

  function goPrev() {
    calendarRef.current?.getApi().prev()
  }

  function goNext() {
    calendarRef.current?.getApi().next()
  }

  function handleEventDragStart(arg: EventDragStartArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (!taskId) return

    const rect = arg.el.getBoundingClientRect()
    stackDragRef.current = {
      taskId,
      subjectEl: arg.el,
      originTop: rect.top,
      originLeft: rect.left,
    }

    const tick = () => {
      if (!stackDragRef.current) return
      syncStackDragTransforms()
      stackDragRafRef.current = requestAnimationFrame(tick)
    }
    stackDragRafRef.current = requestAnimationFrame(tick)
  }

  function handleEventDragStop(_arg: EventDragStopArg) {
    stopStackDragTracking()
    clearStackDragTransforms()
  }

  function handleEventDrop(arg: EventDropArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (!taskId || !arg.event.start || !arg.oldEvent.start) {
      arg.revert()
      return
    }
    stopStackDragTracking()
    clearStackDragTransforms()
    // Moving any block shifts the whole stack by the same delta.
    onStackShift(arg.event.start.getTime() - arg.oldEvent.start.getTime())
  }

  function handleEventResize(arg: EventResizeDoneArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (!taskId || !arg.event.start || !arg.event.end) {
      arg.revert()
      return
    }
    const durationMinutes = Math.max(
      1,
      Math.round(
        (arg.event.end.getTime() - arg.event.start.getTime()) / 60_000,
      ),
    )
    onTaskDurationChange(taskId, durationMinutes)
  }

  function handleSelect(arg: DateSelectArg) {
    onSelectSlot?.(arg.start, arg.end)
    calendarRef.current?.getApi().unselect()
  }

  function handleEventClick(arg: EventClickArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (taskId) onTaskClick?.(taskId)
  }

  function handleEventContent(arg: EventContentArg) {
    if (arg.event.extendedProps.source !== 'task') return true

    const start = arg.event.start
    const timeText = start
      ? new Intl.DateTimeFormat(undefined, {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
          .format(start)
          .replace(/\s/g, '')
          .toLowerCase()
      : ''

    return (
      <div className="fc-event-main-frame">
        {timeText ? (
          <div className="fc-event-time">{timeText}&nbsp;&nbsp;</div>
        ) : null}
        <div className="fc-event-title">{arg.event.title}</div>
      </div>
    )
  }

  return (
    <div className="calendar-shell" ref={shellRef}>
      <div className="calendar-toolbar">
        <div className="calendar-toolbar-side calendar-toolbar-left">
          <div className="calendar-nav">
            <button
              type="button"
              className="btn btn-ghost btn-icon calendar-nav-btn"
              aria-label="Previous"
              onClick={goPrev}
            >
              <ChevronIcon direction="left" />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon calendar-nav-btn"
              aria-label="Next"
              onClick={goNext}
            >
              <ChevronIcon direction="right" />
            </button>
            {!isOnToday && (
              <button
                type="button"
                className="btn btn-ghost btn-icon calendar-today-btn"
                aria-label="Today"
                title="Today"
                onClick={goToday}
              >
                <TodayIcon />
              </button>
            )}
          </div>
        </div>

        <div className="calendar-toolbar-center">
          <h2 className="calendar-title">{title}</h2>
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
                onClick={() => {
                  setMenuOpen(false)
                  setCalendarsOpen((open) => !open)
                }}
              >
                🗓️
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
                onClick={() => {
                  setCalendarsOpen(false)
                  setMenuOpen((open) => !open)
                }}
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
                    onClick={() => {
                      setShowAllDay((v) => !v)
                      setMenuOpen(false)
                    }}
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
                    onClick={() => changeView('timeGridDay')}
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
                    onClick={() => changeView('timeGridThreeDay')}
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
                      onClick={() => changeView('timeGridWeek')}
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

      <div
        className="calendar-body"
        ref={calendarBodyRef}
        style={{ ['--cal-zoom' as string]: String(zoom) }}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridDay"
          headerToolbar={false}
          views={{
            timeGridThreeDay: {
              type: 'timeGrid',
              duration: { days: 3 },
            },
          }}
          titleFormat={TITLE_FORMAT}
          dayHeaders={false}
          height="100%"
          nowIndicator
          editable
          selectable
          selectMirror
          eventStartEditable
          eventDurationEditable
          events={events}
          datesSet={handleDatesSet}
          eventDragStart={handleEventDragStart}
          eventDragStop={handleEventDragStop}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          select={handleSelect}
          eventClick={handleEventClick}
          eventContent={handleEventContent}
          slotMinTime="05:00:00"
          slotMaxTime="24:00:00"
          scrollTime="06:00:00"
          slotDuration="00:15:00"
          slotLabelInterval="01:00:00"
          snapDuration="00:05:00"
          eventMinHeight={0}
          eventShortHeight={0}
          eventOrder="order,start,-duration,title"
          eventOrderStrict
          slotEventOverlap
          allDaySlot={showAllDay}
          dayMaxEvents={showAllDay ? false : 0}
          moreLinkClick="popover"
        />
      </div>
    </div>
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
