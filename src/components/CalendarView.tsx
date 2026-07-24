import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import type {
  DateSpanApi,
  DatesSetArg,
  EventApi,
  EventClickArg,
  EventContentArg,
  EventInput,
} from '@fullcalendar/core'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { CalendarEvent, GoogleCalendar } from '../lib/calendarApi'
import type { BlockGroup, StackAnchor } from '../lib/tasks'
import {
  isTodayOrTomorrow,
  isGroupEnabled,
  isTaskEmpty,
  groupEventColors,
  formatCalendarRange,
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

const NARROW_BREAKPOINT = 560

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
  onTaskClick: (taskId: string) => void
  busy?: boolean
}

type ResolvedTaskEvent = {
  taskId: string
  groupId: string
  title: string
  start: Date
  end: Date
}

/** Lay out visible groups once; calendar UI reads times from here. */
function buildResolvedTaskEvents(groups: BlockGroup[]): ResolvedTaskEvent[] {
  return groups
    .filter((group) => isGroupEnabled(group))
    .flatMap((group) =>
      resolveStack(group.tasks, group.anchor)
        .filter((task) => !isTaskEmpty(task))
        .map((task) => ({
        taskId: task.id,
        groupId: group.id,
        title: task.title,
        start: task.start,
        end: task.end,
      })),
    )
}

function resolvedTaskEventMap(
  events: ResolvedTaskEvent[],
): Map<string, ResolvedTaskEvent> {
  return new Map(events.map((event) => [event.taskId, event]))
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
  onTaskClick,
  busy,
}: CalendarViewProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const calendarBodyRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const calendarsMenuRef = useRef<HTMLDivElement>(null)
  const dragOriginStartRef = useRef<number | null>(null)
  /** First FC span.start during a drag — cancels useEventCenter jump. */
  const dragSpanOriginRef = useRef<number | null>(null)
  /** originStart − spanOrigin — nudges FC's grid mirror onto the sibling timeline. */
  const mirrorNudgeMsRef = useRef(0)
  const dragOriginAnchorRef = useRef<StackAnchor | null>(null)
  const dragGroupIdRef = useRef<string | null>(null)
  const pendingDeltaRef = useRef<number | null>(null)
  const dragFinalizedRef = useRef(false)
  /** Pinch started mid-drag — discard any pending stack move on drop. */
  const discardDragRef = useRef(false)
  const onAnchorCommitRef = useRef(onAnchorCommit)
  const onStackShiftPreviewRef = useRef(onStackShiftPreview)
  onAnchorCommitRef.current = onAnchorCommit
  onStackShiftPreviewRef.current = onStackShiftPreview

  /** FullCalendar with height="100%" often lays out at 0 after OAuth gate swap. */
  function refreshCalendarSize(): boolean {
    const el = calendarBodyRef.current
    const api = calendarRef.current?.getApi()
    if (!el || !api) return false
    if (el.clientHeight < 2 || el.clientWidth < 2) return false
    api.updateSize()
    return true
  }

  function scheduleCalendarSizeRefresh() {
    if (refreshCalendarSize()) return

    let attempts = 0
    const retry = () => {
      if (refreshCalendarSize()) return
      if (++attempts >= 24) return
      requestAnimationFrame(retry)
    }
    requestAnimationFrame(retry)

    window.setTimeout(refreshCalendarSize, 50)
    window.setTimeout(refreshCalendarSize, 150)
    window.setTimeout(refreshCalendarSize, 400)
  }

  const resolvedTaskEvents = useMemo(
    () => buildResolvedTaskEvents(groups),
    [groups],
  )
  const groupColors = useMemo(() => {
    const map = new Map<string, ReturnType<typeof groupEventColors>>()
    for (const group of groups) {
      map.set(group.id, groupEventColors(group.color))
    }
    return map
  }, [groups])
  const resolvedTaskEventsRef = useRef(resolvedTaskEvents)
  resolvedTaskEventsRef.current = resolvedTaskEvents

  const [narrow, setNarrow] = useState(false)
  const [title, setTitle] = useState('')
  const [viewType, setViewType] = useState<CalendarViewType>('timeGridDay')
  const viewRangeRef = useRef<{ start: Date; end: Date } | null>(null)
  const [showAllDay, setShowAllDay] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [calendarsOpen, setCalendarsOpen] = useState(false)
  const [isOnToday, setIsOnToday] = useState(true)
  const [farFromTodayOrTomorrow, setFarFromTodayOrTomorrow] = useState(false)

  const { handleEventDragStart, handleEventDragStop, cancelStackDrag } =
    useTaskStackDrag({
      shellRef,
      getVisual: () => ({
        deltaMs: pendingDeltaRef.current,
        mirrorNudgeMs: mirrorNudgeMsRef.current,
      }),
    })

  const { zoom, pinchingRef } = useCalendarZoom({
    bodyRef: calendarBodyRef,
    onZoomChange: () => calendarRef.current?.getApi().updateSize(),
    onPinchStart: () => {
      // Two fingers: zoom only — never create or commit a stack move.
      discardDragRef.current = true
      pendingDeltaRef.current = 0
      mirrorNudgeMsRef.current = 0
      cancelStackDrag()
      syncTaskEventTimes(null)
      onStackShiftPreviewRef.current?.(null, null)
    },
  })

  /** Keep task block labels and FC dates aligned with the resolved stack. */
  function syncTaskEventTimes(
    deltaMs: number | null,
    previewGroupId: string | null = null,
  ) {
    const shell = shellRef.current
    const resolvedByTaskId = resolvedTaskEventsRef.current
    if (!shell || resolvedByTaskId.length === 0) return

    const timesByTaskId = resolvedTaskEventMap(resolvedByTaskId)

    shell.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`).forEach((el) => {
      const isMirror = el.classList.contains('fc-event-mirror')
      const elGroupId = el.dataset.groupId
      if (previewGroupId != null && !isMirror && elGroupId !== previewGroupId) {
        return
      }

      const taskId = el.dataset.taskId
      if (!taskId) return
      const resolved = timesByTaskId.get(taskId)
      if (!resolved) return

      const startMs = resolved.start.getTime()
      el.dataset.startMs = String(startMs)

      const timeEl = el.querySelector('.fc-event-time')
      if (!timeEl) return

      const applyDelta =
        previewGroupId != null &&
        deltaMs != null &&
        deltaMs !== 0 &&
        (isMirror || elGroupId === previewGroupId)
      const next = applyDelta ? startMs + deltaMs : startMs
      timeEl.textContent = `${formatTaskEventTime(new Date(next))}\u00a0\u00a0`
    })
  }

  function publishPreview(deltaMs: number | null) {
    if (pendingDeltaRef.current === deltaMs) return
    pendingDeltaRef.current = deltaMs
    syncTaskEventTimes(deltaMs, dragGroupIdRef.current)
    onStackShiftPreviewRef.current?.(dragGroupIdRef.current, deltaMs)
  }

  /** Apply the pending drag delta once — same as setting start/end. */
  function finalizeStackDrag(deltaMs: number | null) {
    if (dragFinalizedRef.current) return
    dragFinalizedRef.current = true

    const origin = dragOriginAnchorRef.current
    const groupId = dragGroupIdRef.current
    const discard = discardDragRef.current
    cancelStackDrag()
    pendingDeltaRef.current = null
    dragOriginAnchorRef.current = null
    dragOriginStartRef.current = null
    dragSpanOriginRef.current = null
    mirrorNudgeMsRef.current = 0
    dragGroupIdRef.current = null
    discardDragRef.current = false

    if (!discard && origin && groupId && deltaMs != null && deltaMs !== 0) {
      // Leave preview times in place until FC remounts with the commit.
      onAnchorCommitRef.current(groupId, shiftAnchor(origin, deltaMs))
    } else {
      syncTaskEventTimes(null, groupId)
      onStackShiftPreviewRef.current?.(null, null)
    }
  }

  function handleDragStart(arg: Parameters<typeof handleEventDragStart>[0]) {
    if (pinchingRef.current) return
    const groupId = arg.event.extendedProps.groupId as string | undefined
    const group = groups.find((g) => g.id === groupId)
    dragFinalizedRef.current = false
    discardDragRef.current = false
    dragOriginStartRef.current = arg.event.start?.getTime() ?? null
    dragSpanOriginRef.current = null
    mirrorNudgeMsRef.current = 0
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
    // Prefer the grab-corrected preview delta over FC's event/oldEvent delta.
    const deltaMs = pendingDeltaRef.current ?? 0
    // Undo FC's single-event mutation; we commit the whole stack via anchor.
    arg.revert()
    finalizeStackDrag(deltaMs)
  }

  function handleEventResize(arg: { revert: () => void }) {
    // Durations are owned by the plan; never accept calendar resize.
    arg.revert()
  }

  function handleEventAllow(span: DateSpanApi, movingEvent: EventApi | null) {
    if (pinchingRef.current || discardDragRef.current) return false
    if (movingEvent?.extendedProps.source !== 'task') return true
    const originMs = dragOriginStartRef.current
    if (originMs == null || !span.start) return true

    // Keep stacks on the same local calendar day (vertical time moves only).
    const origin = new Date(originMs)
    if (
      span.start.getFullYear() !== origin.getFullYear() ||
      span.start.getMonth() !== origin.getMonth() ||
      span.start.getDate() !== origin.getDate()
    ) {
      return false
    }

    // Refuse duration changes (resize hits have a different end delta).
    if (span.end && movingEvent.end) {
      const originEnd = movingEvent.end.getTime()
      const originStart = movingEvent.start?.getTime()
      if (originStart != null) {
        const originDur = originEnd - originStart
        const nextDur = span.end.getTime() - span.start.getTime()
        if (Math.abs(nextDur - originDur) > 500) return false
      }
    }

    // Anchor preview/commit to the first allowed span so only pointer movement
    // counts. Nudge the FC mirror back by any first-frame snap/center jump so
    // it stays aligned with siblings. Deltas are snapped via snapDuration.
    if (dragSpanOriginRef.current == null) {
      dragSpanOriginRef.current = span.start.getTime()
      mirrorNudgeMsRef.current = originMs - span.start.getTime()
    }
    publishPreview(span.start.getTime() - dragSpanOriginRef.current)
    return true
  }

  useEffect(() => {
    const range = viewRangeRef.current
    if (!range) return
    setTitle(formatCalendarRange(range.start, range.end, viewType))
  }, [viewType])

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

  useLayoutEffect(() => {
    scheduleCalendarSizeRefresh()

    const targets = [shellRef.current, calendarBodyRef.current].filter(
      (el): el is HTMLDivElement => el != null,
    )
    const observer = new ResizeObserver(() => {
      refreshCalendarSize()
    })
    for (const target of targets) observer.observe(target)

    function onShow() {
      if (document.visibilityState === 'hidden') return
      scheduleCalendarSizeRefresh()
    }
    window.addEventListener('focus', onShow)
    document.addEventListener('visibilitychange', onShow)

    return () => {
      observer.disconnect()
      window.removeEventListener('focus', onShow)
      document.removeEventListener('visibilitychange', onShow)
    }
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

  // FullCalendar can keep stale start/end on existing task ids after reorder or
  // anchor edits. Reconcile FC's internal dates and DOM labels from resolveStack.
  useEffect(() => {
    if (dragGroupIdRef.current != null) return

    const api = calendarRef.current?.getApi()
    if (api) {
      for (const task of resolvedTaskEvents) {
        const event = api.getEventById(`task:${task.taskId}`)
        if (!event?.start || !event.end) continue
        if (
          event.start.getTime() !== task.start.getTime() ||
          event.end.getTime() !== task.end.getTime()
        ) {
          event.setDates(task.start, task.end)
        }
      }
    }

    const frame = requestAnimationFrame(() => {
      syncTaskEventTimes(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [resolvedTaskEvents])

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

    const local: EventInput[] = resolvedTaskEvents.map((task) => {
      const colors = groupColors.get(task.groupId) ?? groupEventColors()
      return {
        id: `task:${task.taskId}`,
        title: task.title,
        start: task.start.toISOString(),
        end: task.end.toISOString(),
        backgroundColor: colors.backgroundColor,
        borderColor: colors.borderColor,
        // Move only — `editable: true` would re-enable duration resize.
        startEditable: true,
        durationEditable: false,
        order: 0,
        classNames: [TASK_STACK_CLASS, ...durationClass(task.start, task.end)],
        extendedProps: {
          source: 'task',
          taskId: task.taskId,
          groupId: task.groupId,
        },
      }
    })

    return [...google, ...local]
  }, [googleEvents, groupColors, resolvedTaskEvents, showAllDay])

  function handleDatesSet(arg: DatesSetArg) {
    const type = arg.view.type
    viewRangeRef.current = { start: arg.start, end: arg.end }
    if (
      type === 'timeGridDay' ||
      type === 'timeGridThreeDay' ||
      type === 'timeGridWeek'
    ) {
      setViewType(type)
      setTitle(formatCalendarRange(arg.start, arg.end, type))
    } else {
      setTitle(arg.view.title)
    }
    const now = new Date()
    setIsOnToday(now >= arg.start && now < arg.end)
    setFarFromTodayOrTomorrow(
      !isTodayOrTomorrow(pickViewDate(arg.start, arg.end, now)),
    )
    onDatesSet(arg.start, arg.end)
    scheduleCalendarSizeRefresh()
  }

  function changeView(next: CalendarViewType) {
    calendarRef.current?.getApi().changeView(next)
    setViewType(next)
    setMenuOpen(false)
  }

  function handleEventClick(arg: EventClickArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (taskId) onTaskClick(taskId)
  }

  function handleEventContent(arg: EventContentArg) {
    if (arg.event.extendedProps.source !== 'task') return true

    const taskId = arg.event.extendedProps.taskId as string | undefined
    const resolved = taskId
      ? resolvedTaskEventsRef.current.find((task) => task.taskId === taskId)
      : undefined
    const start = resolved?.start ?? arg.event.start
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
          dayHeaders={false}
          height="100%"
          windowResize={() => {
            refreshCalendarSize()
          }}
          nowIndicator
          editable
          selectable={false}
          eventStartEditable
          eventDurationEditable={false}
          // Immediate event drag on touch; slot select is disabled (no create).
          eventLongPressDelay={0}
          events={events}
          datesSet={handleDatesSet}
          eventAllow={handleEventAllow}
          eventDragStart={handleDragStart}
          eventDragStop={handleDragStop}
          eventDrop={handleDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          eventContent={handleEventContent}
          eventDidMount={(info) => {
            const groupId = info.event.extendedProps.groupId
            const taskId = info.event.extendedProps.taskId
            if (typeof groupId === 'string') {
              info.el.dataset.groupId = groupId
            }
            if (typeof taskId === 'string') {
              info.el.dataset.taskId = taskId
              const resolved = resolvedTaskEventsRef.current.find(
                (task) => task.taskId === taskId,
              )
              if (resolved) {
                info.el.dataset.startMs = String(resolved.start.getTime())
              } else if (info.event.start) {
                info.el.dataset.startMs = String(info.event.start.getTime())
              }
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
