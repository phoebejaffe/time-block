import { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import type {
  DateSelectArg,
  DateSpanApi,
  DatesSetArg,
  EventApi,
  EventClickArg,
  EventContentArg,
  EventInput,
  FormatterInput,
} from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { CalendarEvent, GoogleCalendar } from '../lib/calendarApi'
import type { BlockGroup, StackAnchor } from '../lib/tasks'
import {
  isTodayOrTomorrow,
  pickViewDate,
  resolveStack,
  shiftAnchor,
} from '../lib/tasks'
import { useCalendarZoom } from '../hooks/useCalendarZoom'
import {
  TASK_STACK_CLASS,
  useTaskStackDrag,
} from '../hooks/useTaskStackDrag'
import {
  CalendarToolbar,
  type CalendarViewType,
} from './CalendarToolbar'

const TASK_COLOR = '#0f6e56'
const TASK_BORDER = '#0b5341'
const NARROW_BREAKPOINT = 560

const TITLE_FORMAT: FormatterInput = {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}

type CalendarViewProps = {
  googleEvents: CalendarEvent[]
  calendars: GoogleCalendar[]
  visibleCalendarIds: Set<string>
  onToggleCalendar: (calendarId: string) => void
  groups: BlockGroup[]
  onDatesSet: (start: Date, end: Date) => void
  /** Commit a new stack anchor for a group (same path as editing start/end). */
  onAnchorCommit: (groupId: string, anchor: StackAnchor) => void
  /** Live stack time shift while dragging (null group/delta when drag ends). */
  onStackShiftPreview?: (
    groupId: string | null,
    deltaMs: number | null,
  ) => void
  onTaskDurationChange: (
    groupId: string,
    taskId: string,
    durationMinutes: number,
  ) => void
  onSelectSlot: (groupId: string, start: Date, end: Date) => void
  onTaskClick: (taskId: string) => void
  busy?: boolean
}

/** Tighter layout for short events: <30 min, <=10 min, and <=5 min. */
function durationClass(start: Date | string, end: Date | string): string[] {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return []
  const minutes = ms / 60_000
  if (minutes <= 5) return ['event-xs', 'event-xxs']
  if (minutes <= 10) return ['event-xs']
  if (minutes < 30) return ['event-sm']
  return []
}

function formatTaskEventTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .replace(/\s/g, '')
    .toLowerCase()
}

export function CalendarView({
  googleEvents,
  calendars,
  visibleCalendarIds,
  onToggleCalendar,
  groups,
  onDatesSet,
  onAnchorCommit,
  onStackShiftPreview,
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
  const dragOriginStartRef = useRef<number | null>(null)
  const dragOriginAnchorRef = useRef<StackAnchor | null>(null)
  const dragGroupIdRef = useRef<string | null>(null)
  const pendingDeltaRef = useRef<number | null>(null)
  const dragFinalizedRef = useRef(false)
  const onAnchorCommitRef = useRef(onAnchorCommit)
  const onStackShiftPreviewRef = useRef(onStackShiftPreview)
  onAnchorCommitRef.current = onAnchorCommit
  onStackShiftPreviewRef.current = onStackShiftPreview

  const [narrow, setNarrow] = useState(false)
  const [title, setTitle] = useState('')
  const [viewType, setViewType] = useState<CalendarViewType>('timeGridDay')
  const [showAllDay, setShowAllDay] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [calendarsOpen, setCalendarsOpen] = useState(false)
  const [isOnToday, setIsOnToday] = useState(true)
  const [farFromTodayOrTomorrow, setFarFromTodayOrTomorrow] = useState(false)

  const zoom = useCalendarZoom({
    bodyRef: calendarBodyRef,
    onZoomChange: () => calendarRef.current?.getApi().updateSize(),
  })

  const { handleEventDragStart, handleEventDragStop, cancelStackDrag } =
    useTaskStackDrag({ shellRef })

  /** Live-update time labels on the whole stack while one event is dragged. */
  function syncStackPreviewTimes(
    deltaMs: number | null,
    groupId = dragGroupIdRef.current,
  ) {
    const shell = shellRef.current
    if (!shell || !groupId) return

    shell.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`).forEach((el) => {
      if (el.dataset.groupId !== groupId) return
      if (el.classList.contains('fc-event-mirror')) return

      const startMs = Number(el.dataset.startMs)
      const timeEl = el.querySelector('.fc-event-time')
      if (!timeEl || !Number.isFinite(startMs)) return

      const next =
        deltaMs == null || deltaMs === 0 ? startMs : startMs + deltaMs
      timeEl.textContent = `${formatTaskEventTime(new Date(next))}\u00a0\u00a0`
    })
  }

  function publishPreview(deltaMs: number | null) {
    if (pendingDeltaRef.current === deltaMs) return
    pendingDeltaRef.current = deltaMs
    syncStackPreviewTimes(deltaMs)
    onStackShiftPreviewRef.current?.(dragGroupIdRef.current, deltaMs)
  }

  /** Apply the pending drag delta once — same as setting start/end. */
  function finalizeStackDrag(deltaMs: number | null) {
    if (dragFinalizedRef.current) return
    dragFinalizedRef.current = true

    const origin = dragOriginAnchorRef.current
    const groupId = dragGroupIdRef.current
    cancelStackDrag()
    pendingDeltaRef.current = null
    dragOriginAnchorRef.current = null
    dragOriginStartRef.current = null
    dragGroupIdRef.current = null

    if (origin && groupId && deltaMs != null && deltaMs !== 0) {
      // Leave preview times in place until FC remounts with the commit.
      onAnchorCommitRef.current(groupId, shiftAnchor(origin, deltaMs))
    } else {
      syncStackPreviewTimes(null, groupId)
      onStackShiftPreviewRef.current?.(null, null)
    }
  }

  function handleDragStart(arg: Parameters<typeof handleEventDragStart>[0]) {
    const groupId = arg.event.extendedProps.groupId as string | undefined
    const group = groups.find((g) => g.id === groupId)
    dragFinalizedRef.current = false
    dragOriginStartRef.current = arg.event.start?.getTime() ?? null
    dragOriginAnchorRef.current = group?.anchor ?? null
    dragGroupIdRef.current = groupId ?? null
    pendingDeltaRef.current = null
    handleEventDragStart(arg)
  }

  function handleDragStop(arg: Parameters<typeof handleEventDragStop>[0]) {
    // dragStop runs before drop. Capture delta now; finalize after drop has
    // had a chance to run (or on its own if FC skips eventDrop).
    handleEventDragStop(arg)
    const deltaAtStop = pendingDeltaRef.current
    queueMicrotask(() => {
      finalizeStackDrag(deltaAtStop)
    })
  }

  function handleDrop(arg: {
    event: { start: Date | null }
    oldEvent: { start: Date | null }
    revert: () => void
  }) {
    const fcDelta =
      arg.event.start && arg.oldEvent.start
        ? arg.event.start.getTime() - arg.oldEvent.start.getTime()
        : 0
    const deltaMs = pendingDeltaRef.current ?? fcDelta
    // Undo FC's single-event mutation; we commit the whole stack via anchor.
    arg.revert()
    finalizeStackDrag(deltaMs)
  }

  function handleEventAllow(span: DateSpanApi, movingEvent: EventApi | null) {
    if (movingEvent?.extendedProps.source !== 'task') return true
    const origin = dragOriginStartRef.current
    if (origin == null || !span.start) return true
    // Preview only — calendar event data stays on the committed anchor so FC
    // still sees a real drop. Sidebar follows via displayAnchor.
    publishPreview(span.start.getTime() - origin)
    return true
  }

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
        classNames: e.allDay ? [] : durationClass(e.start, e.end),
        extendedProps: e.extendedProps,
      }))

    const local: EventInput[] = groups
      .filter((group) => !group.hidden)
      .flatMap((group) =>
        resolveStack(group.tasks, group.anchor).map((task) => ({
          id: `task:${task.id}`,
          title: task.title,
          start: task.start.toISOString(),
          end: task.end.toISOString(),
          backgroundColor: TASK_COLOR,
          borderColor: TASK_BORDER,
          editable: true,
          order: 0,
          classNames: [
            TASK_STACK_CLASS,
            ...durationClass(task.start, task.end),
          ],
          extendedProps: {
            source: 'task',
            taskId: task.id,
            groupId: group.id,
          },
        })),
      )

    return [...google, ...local]
  }, [googleEvents, groups, showAllDay])

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
    setFarFromTodayOrTomorrow(
      !isTodayOrTomorrow(pickViewDate(arg.start, arg.end, now)),
    )
    onDatesSet(arg.start, arg.end)
  }

  function changeView(next: CalendarViewType) {
    calendarRef.current?.getApi().changeView(next)
    setViewType(next)
    setMenuOpen(false)
  }

  function handleEventResize(arg: EventResizeDoneArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    const groupId = arg.event.extendedProps.groupId as string | undefined
    if (!taskId || !groupId || !arg.event.start || !arg.event.end) {
      arg.revert()
      return
    }
    const durationMinutes = Math.max(
      1,
      Math.round(
        (arg.event.end.getTime() - arg.event.start.getTime()) / 60_000,
      ),
    )
    // Duration change reflows the whole stack via resolveStack.
    arg.revert()
    onTaskDurationChange(groupId, taskId, durationMinutes)
  }

  function handleSelect(arg: DateSelectArg) {
    const groupId = groups.find((g) => !g.hidden)?.id
    if (groupId) onSelectSlot(groupId, arg.start, arg.end)
    calendarRef.current?.getApi().unselect()
  }

  function handleEventClick(arg: EventClickArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (taskId) onTaskClick(taskId)
  }

  function handleEventContent(arg: EventContentArg) {
    if (arg.event.extendedProps.source !== 'task') return true

    const start = arg.event.start
    const timeText = start ? formatTaskEventTime(start) : ''

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
      <CalendarToolbar
        title={title}
        isOnToday={isOnToday}
        farFromTodayOrTomorrow={farFromTodayOrTomorrow}
        viewType={viewType}
        narrow={narrow}
        showAllDay={showAllDay}
        menuOpen={menuOpen}
        calendarsOpen={calendarsOpen}
        calendars={calendars}
        visibleCalendarIds={visibleCalendarIds}
        busy={busy}
        menuRef={menuRef}
        calendarsMenuRef={calendarsMenuRef}
        onPrev={() => calendarRef.current?.getApi().prev()}
        onNext={() => calendarRef.current?.getApi().next()}
        onToday={() => calendarRef.current?.getApi().today()}
        onToggleMenu={() => {
          setCalendarsOpen(false)
          setMenuOpen((open) => !open)
        }}
        onToggleCalendars={() => {
          setMenuOpen(false)
          setCalendarsOpen((open) => !open)
        }}
        onToggleAllDay={() => {
          setShowAllDay((v) => !v)
          setMenuOpen(false)
        }}
        onChangeView={changeView}
        onToggleCalendar={onToggleCalendar}
      />

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
          eventAllow={handleEventAllow}
          eventDragStart={handleDragStart}
          eventDragStop={handleDragStop}
          eventDrop={handleDrop}
          eventResize={handleEventResize}
          select={handleSelect}
          eventClick={handleEventClick}
          eventContent={handleEventContent}
          eventDidMount={(info) => {
            const groupId = info.event.extendedProps.groupId
            if (typeof groupId === 'string') {
              info.el.dataset.groupId = groupId
            }
            if (
              info.event.extendedProps.source === 'task' &&
              info.event.start
            ) {
              info.el.dataset.startMs = String(info.event.start.getTime())
            }
          }}
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
