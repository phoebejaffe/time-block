import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import type {
  DateSpanApi,
  DatesSetArg,
  EventApi,
  EventClickArg,
  EventContentArg,
  EventInput,
  SlotLabelContentArg,
  SlotLabelMountArg,
} from '@fullcalendar/core'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { CalendarEvent, GoogleCalendar } from '../lib/calendarApi'
import type { BlockGroup, StackAnchor } from '../lib/tasks'
import {
  canNavigateCalendarRange,
  isTodayOrTomorrow,
  isGroupEnabled,
  isTaskDisabled,
  isTaskEmpty,
  groupEventColors,
  desaturateEventColors,
  formatCalendarRange,
  pickViewDate,
  resolveStack,
  shiftAnchor,
  startOfLocalDay,
} from '../lib/tasks'
import {
  findTimegridScroller,
  useCalendarZoom,
} from '../hooks/useCalendarZoom'
import { useFitEnabledPlans } from '../hooks/useFitEnabledPlans'
import {
  CALENDAR_SLOT_MINUTES,
  calendarSlotBounds,
  enabledPlansTimeRange,
  scrollTopForSlotMinChange,
} from '../lib/calendarFit'
import {
  TASK_STACK_CLASS,
  useTaskStackDrag,
} from '../hooks/useTaskStackDrag'
import {
  CalendarToolbar,
  type CalendarViewType,
} from './CalendarToolbar'

const NARROW_BREAKPOINT = 560
/** Touch: hold before stack drag so vertical swipes scroll the calendar. */
const TASK_EVENT_LONG_PRESS_MS = 400

function setCalendarDragging(active: boolean) {
  document.body.classList.toggle('is-calendar-dragging', active)
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
  onTaskClick: (taskId: string) => void
  busy?: boolean
  calendarsLoading?: boolean
  /** When false, task stack drag on the calendar is disabled (execution mode). */
  stackDragEnabled?: boolean
  /**
   * When set (execution mode), ‹ › are disabled if the next step would leave
   * these inclusive local days occupied by the executing stack.
   */
  navDayBounds?: { first: Date; last: Date } | null
  /** Scroll the time grid so the group's blocks are in view (execution open). */
  scrollTasksIntoViewOnMount?: boolean
  /** Initial local day for an execution occurrence. */
  initialDate?: Date
}

type ResolvedTaskEvent = {
  taskId: string
  groupId: string
  title: string
  start: Date
  end: Date
  empty?: boolean
}

/** Lay out visible groups once; calendar UI reads times from here. */
function buildResolvedTaskEvents(groups: BlockGroup[]): ResolvedTaskEvent[] {
  return groups
    .filter((group) => isGroupEnabled(group))
    .flatMap((group) =>
      resolveStack(group.tasks, group.anchor)
        .filter((task) => !isTaskDisabled(task))
        .map((task) => ({
          taskId: task.id,
          groupId: group.id,
          title: task.title,
          start: task.start,
          end: task.end,
          ...(isTaskEmpty(task) ? { empty: true } : {}),
        })),
    )
}

function resolvedTaskEventMap(
  events: ResolvedTaskEvent[],
): Map<string, ResolvedTaskEvent> {
  return new Map(events.map((event) => [event.taskId, event]))
}

/** Tighter layout for short events: <30 min, with compact labels by duration. */
function durationClass(start: Date | string, end: Date | string): string[] {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return []
  const minutes = ms / 60_000
  if (minutes <= 5) return ['event-xs', 'event-xxs']
  if (minutes <= 10) return ['event-xs', 'event-compact-10']
  if (minutes <= 15) return ['event-sm', 'event-compact-15']
  if (minutes <= 20) return ['event-sm', 'event-compact-20']
  if (minutes < 30) return ['event-sm']
  return []
}

/** Width for task-event time labels (≈ longest en-US 12h string, slightly tight). */
const TASK_EVENT_TIME_CHARS = 6.5

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

function localDayOffset(date: Date, baseDay: Date): number {
  const dateDay = startOfLocalDay(date)
  const base = startOfLocalDay(baseDay)
  const cursor = new Date(base)
  let offset = 0
  while (cursor.getTime() < dateDay.getTime() && offset < 2) {
    cursor.setDate(cursor.getDate() + 1)
    offset += 1
  }
  if (cursor.getTime() === dateDay.getTime()) return offset
  cursor.setTime(base.getTime())
  offset = 0
  while (cursor.getTime() > dateDay.getTime() && offset > -2) {
    cursor.setDate(cursor.getDate() - 1)
    offset -= 1
  }
  return cursor.getTime() === dateDay.getTime() ? offset : 0
}

function formatSlotMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const absolute = Math.abs(minutes)
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}:00`
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(normalized)) return null
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ]
}

function srgbChannel(value: number): number {
  const s = value / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function contrastingTextColor(
  backgroundColor: string,
): '#000000' | '#ffffff' {
  const rgb = hexToRgb(backgroundColor)
  if (!rgb) return '#ffffff'
  const [r, g, b] = rgb.map(srgbChannel)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.45 ? '#000000' : '#ffffff'
}

function oppositeTextColor(
  color: '#000000' | '#ffffff',
): '#000000' | '#ffffff' {
  return color === '#000000' ? '#ffffff' : '#000000'
}

function textOutlineShadow(
  color: '#000000' | '#ffffff',
  px = 1,
  blur = 2,
  opacity = 0.1,
): string {
  const shadowColor =
    color === '#000000'
      ? `rgba(0, 0, 0, ${opacity})`
      : `rgba(255, 255, 255, ${opacity})`
  const coords: Array<[number, number]> = [
    [-px, -px],
    [0, -px],
    [px, -px],
    [-px, 0],
    [px, 0],
    [-px, px],
    [0, px],
    [px, px],
  ]
  const outline = coords
    .map(([x, y]) => `${x}px ${y}px ${blur}px ${shadowColor}`)
    .join(', ')
  return `${outline}, 0 0 ${blur * 2}px ${shadowColor}`
}

function taskEventTextStyle(groupBackgroundColor: string): {
  color: '#000000' | '#ffffff'
  textShadow: string
} {
  const color = contrastingTextColor(groupBackgroundColor)
  return {
    color,
    textShadow: textOutlineShadow(oppositeTextColor(color)),
  }
}

/**
 * Task event label: time floats left so the title starts beside it on the
 * first line, wraps to subsequent full-width lines, then ellipsizes once it
 * runs out of the event box's height. Below zoom 1.7, `event-xxs` (≤5min)
 * CSS lets the label overflow above the tiny box instead of clamping.
 */
function TaskEventLabel({
  timeText,
  title,
  clamp,
  textStyle,
}: {
  timeText: string
  title: string
  clamp: boolean
  textStyle: { color: '#000000' | '#ffffff'; textShadow: string }
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!clamp) return
    const frame = frameRef.current
    const titleEl = titleRef.current
    if (!frame || !titleEl) return

    function applyClamp() {
      if (!frame || !titleEl) return
      const availableHeight = frame.clientHeight
      if (availableHeight <= 0) return
      const style = window.getComputedStyle(titleEl)
      const fontSize = parseFloat(style.fontSize) || 11
      const lineHeight =
        style.lineHeight === 'normal'
          ? fontSize * 1.2
          : parseFloat(style.lineHeight) || fontSize * 1.2
      const lines = Math.max(1, Math.floor(availableHeight / lineHeight))
      titleEl.style.setProperty('--title-lines', String(lines))
    }

    applyClamp()
    const observer = new ResizeObserver(applyClamp)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [clamp])

  return (
    <div className="fc-event-main-frame" ref={frameRef}>
      {timeText ? (
        <div className="fc-event-time" style={textStyle}>
          {timeText}
        </div>
      ) : null}
      <div className="fc-event-title" ref={titleRef} style={textStyle}>
        {title}
      </div>
    </div>
  )
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
  calendarsLoading = false,
  stackDragEnabled = true,
  navDayBounds = null,
  scrollTasksIntoViewOnMount = false,
  initialDate,
}: CalendarViewProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const calendarBodyRef = useRef<HTMLDivElement>(null)
  const slotScrollSnapshotRef = useRef<{
    minMinutes: number
    maxMinutes: number
    scrollTop: number
    slotHeight: number
  } | null>(null)
  /** Pixel height — `height="100%"` breaks after the OAuth gate; numeric height sticks across re-renders. */
  const [calendarHeight, setCalendarHeight] = useState(0)
  const dragOriginStartRef = useRef<number | null>(null)
  /** First FC span.start during a drag — cancels useEventCenter jump. */
  const dragSpanOriginRef = useRef<number | null>(null)
  /** originStart − spanOrigin — nudges FC's grid mirror onto the sibling timeline. */
  const mirrorNudgeMsRef = useRef(0)
  const dragOriginAnchorRef = useRef<StackAnchor | null>(null)
  const dragGroupIdRef = useRef<string | null>(null)
  const dragTaskIdRef = useRef<string | null>(null)
  const pendingDeltaRef = useRef<number | null>(null)
  const dragFinalizedRef = useRef(false)
  /** Pinch started mid-drag — discard any pending stack move on drop. */
  const discardDragRef = useRef(false)
  const onAnchorCommitRef = useRef(onAnchorCommit)
  const onStackShiftPreviewRef = useRef(onStackShiftPreview)
  onAnchorCommitRef.current = onAnchorCommit
  onStackShiftPreviewRef.current = onStackShiftPreview

  /**
   * Measure the flex parent and feed FullCalendar an integer height.
   * Percentage height is unreliable after the sign-in gate mounts the grid,
   * and React re-renders would reset `height="100%"` after updateSize().
   */
  function syncCalendarHeight() {
    const el = calendarBodyRef.current
    if (!el) return
    const next = Math.floor(el.getBoundingClientRect().height)
    if (next < 2) return
    setCalendarHeight((prev) => (prev === next ? prev : next))
  }

  function scheduleCalendarHeightSync() {
    syncCalendarHeight()
    requestAnimationFrame(() => {
      syncCalendarHeight()
      requestAnimationFrame(syncCalendarHeight)
    })
    window.setTimeout(syncCalendarHeight, 50)
    window.setTimeout(syncCalendarHeight, 150)
    window.setTimeout(syncCalendarHeight, 400)
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
  const dismissMenus = useCallback(() => {
    setMenuOpen(false)
    setCalendarsOpen(false)
  }, [])
  const [isOnToday, setIsOnToday] = useState(true)
  const [farFromTodayOrTomorrow, setFarFromTodayOrTomorrow] = useState(false)
  const [prevDisabled, setPrevDisabled] = useState(false)
  const [nextDisabled, setNextDisabled] = useState(false)

  function syncNavDisabled(rangeStart: Date, rangeEnd: Date) {
    if (!navDayBounds) {
      setPrevDisabled(false)
      setNextDisabled(false)
      return
    }
    setPrevDisabled(
      !canNavigateCalendarRange(rangeStart, rangeEnd, navDayBounds, 'prev'),
    )
    setNextDisabled(
      !canNavigateCalendarRange(rangeStart, rangeEnd, navDayBounds, 'next'),
    )
  }

  const { handleEventDragStart, handleEventDragStop, cancelStackDrag, syncStackDragTransforms } =
    useTaskStackDrag({
      shellRef,
      getVisual: () => ({
        deltaMs: pendingDeltaRef.current,
        mirrorNudgeMs: mirrorNudgeMsRef.current,
      }),
      onDragFrame: () => syncTaskEventTimes(),
    })

  const { zoom, pinchingRef, setZoomUnanchored } = useCalendarZoom({
    bodyRef: calendarBodyRef,
    onZoomChange: () => {
      calendarRef.current?.getApi().updateSize()
    },
    onPinchStart: () => {
      // Two fingers: zoom only — never create or commit a stack move.
      discardDragRef.current = true
      pendingDeltaRef.current = 0
      mirrorNudgeMsRef.current = 0
      cancelStackDrag()
      syncTaskEventTimes()
      onStackShiftPreviewRef.current?.(null, null)
    },
  })

  useFitEnabledPlans({
    groups,
    bodyRef: calendarBodyRef,
    zoom,
    setZoomUnanchored,
    pinchingRef,
    calendarHeight,
    fitOnMount: scrollTasksIntoViewOnMount,
    includeNow: isOnToday,
  })

  /**
   * Keep task block time labels aligned with the resolved stack. During a
   * drag, calendar siblings move via DOM transform (not shifted `groups`), so
   * apply the pending delta to labels for the dragged group.
   */
  function syncTaskEventTimes() {
    const shell = shellRef.current
    const resolvedByTaskId = resolvedTaskEventsRef.current
    if (!shell || resolvedByTaskId.length === 0) return

    const timesByTaskId = resolvedTaskEventMap(resolvedByTaskId)
    const deltaMs = pendingDeltaRef.current
    const previewGroupId = dragGroupIdRef.current

    shell.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`).forEach((el) => {
      const elGroupId = el.dataset.groupId
      const taskId =
        el.dataset.taskId ??
        (el.classList.contains('fc-event-mirror') ? dragTaskIdRef.current : null)
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
        elGroupId === previewGroupId
      const next = applyDelta ? startMs + deltaMs : startMs
      timeEl.textContent = formatTaskEventTime(new Date(next))
    })
  }

  function publishPreview(deltaMs: number | null) {
    if (pendingDeltaRef.current === deltaMs) return
    pendingDeltaRef.current = deltaMs
    syncStackDragTransforms()
    syncTaskEventTimes()
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
    dragTaskIdRef.current = null
    discardDragRef.current = false
    setCalendarDragging(false)

    if (!discard && origin && groupId && deltaMs != null && deltaMs !== 0) {
      // Leave preview times in place until FC remounts with the commit.
      onAnchorCommitRef.current(groupId, shiftAnchor(origin, deltaMs))
    } else {
      syncTaskEventTimes()
      onStackShiftPreviewRef.current?.(null, null)
    }
  }

  function handleDragStart(arg: Parameters<typeof handleEventDragStart>[0]) {
    if (pinchingRef.current) return
    setCalendarDragging(true)
    const groupId = arg.event.extendedProps.groupId as string | undefined
    const taskId = arg.event.extendedProps.taskId as string | undefined
    const group = groups.find((g) => g.id === groupId)
    dragFinalizedRef.current = false
    discardDragRef.current = false
    dragOriginStartRef.current = arg.event.start?.getTime() ?? null
    dragSpanOriginRef.current = null
    mirrorNudgeMsRef.current = 0
    dragOriginAnchorRef.current = group?.anchor ?? null
    dragGroupIdRef.current = groupId ?? null
    dragTaskIdRef.current = taskId ?? null
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
    if (!stackDragEnabled) return false
    if (pinchingRef.current || discardDragRef.current) return false
    if (movingEvent?.extendedProps.source !== 'task') return true
    const originMs = dragOriginStartRef.current
    if (originMs == null || !span.start) return true

    // Day view's overflow slots are a continuation of the same vertical
    // timeline, so crossing midnight is a valid stack shift. In multi-day
    // views, retain the column-change guard and keep movement vertical.
    if (viewType !== 'timeGridDay') {
      const origin = new Date(originMs)
      if (
        span.start.getFullYear() !== origin.getFullYear() ||
        span.start.getMonth() !== origin.getMonth() ||
        span.start.getDate() !== origin.getDate()
      ) {
        return false
      }
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
    scheduleCalendarHeightSync()

    const el = calendarBodyRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      syncCalendarHeight()
    })
    observer.observe(el)
    if (shellRef.current) observer.observe(shellRef.current)

    function onShow() {
      if (document.visibilityState === 'hidden') return
      scheduleCalendarHeightSync()
    }
    window.addEventListener('focus', onShow)
    window.addEventListener('resize', syncCalendarHeight)
    document.addEventListener('visibilitychange', onShow)

    return () => {
      observer.disconnect()
      window.removeEventListener('focus', onShow)
      window.removeEventListener('resize', syncCalendarHeight)
      document.removeEventListener('visibilitychange', onShow)
      setCalendarDragging(false)
    }
  }, [])

  useEffect(() => {
    if (!narrow) return
    if (viewType !== 'timeGridWeek') return
    const api = calendarRef.current?.getApi()
    api?.changeView('timeGridThreeDay')
    setViewType('timeGridThreeDay')
  }, [narrow, viewType])

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
      syncTaskEventTimes()
    })
    return () => cancelAnimationFrame(frame)
  }, [resolvedTaskEvents])

  function logicalViewDay(): Date {
    const anchor = groups.find(isGroupEnabled)?.anchor.at
    if (anchor) {
      const date = new Date(anchor)
      if (!Number.isNaN(date.getTime())) return startOfLocalDay(date)
    }
    const rangeStart = viewRangeRef.current?.start
    if (rangeStart) return rangeStart
    return startOfLocalDay()
  }

  const slotRange = useMemo(() => {
    const bounds = calendarSlotBounds(enabledPlansTimeRange(groups))
    return {
      ...bounds,
      min: formatSlotMinutes(bounds.minMinutes),
      max: formatSlotMinutes(bounds.maxMinutes),
    }
  }, [groups])

  useLayoutEffect(() => {
    const body = calendarBodyRef.current
    if (!body) return
    const scroller = findTimegridScroller(body)
    const slot = scroller?.querySelector<HTMLElement>('.fc-timegrid-slot')
    if (!scroller || !slot) return
    const slotHeight = slot.getBoundingClientRect().height
    if (slotHeight <= 0) return

    const previous = slotScrollSnapshotRef.current
    const rangeChanged =
      previous &&
      (previous.minMinutes !== slotRange.minMinutes ||
        previous.maxMinutes !== slotRange.maxMinutes)
    if (rangeChanged) {
      scroller.scrollTop = scrollTopForSlotMinChange(
        previous.scrollTop,
        previous.minMinutes,
        slotRange.minMinutes,
        CALENDAR_SLOT_MINUTES,
        previous.slotHeight,
        slotHeight,
      )
    }

    const capture = () => {
      slotScrollSnapshotRef.current = {
        minMinutes: slotRange.minMinutes,
        maxMinutes: slotRange.maxMinutes,
        scrollTop: scroller.scrollTop,
        slotHeight,
      }
    }
    capture()
    scroller.addEventListener('scroll', capture, { passive: true })
    return () => scroller.removeEventListener('scroll', capture)
  }, [calendarHeight, slotRange.maxMinutes, slotRange.minMinutes, zoom])

  useLayoutEffect(() => {
    const body = calendarBodyRef.current
    if (!body) return
    const rows = body.querySelectorAll<HTMLTableRowElement>(
      '.fc-timegrid-slots tr',
    )
    rows.forEach((row, index) => {
      const label = row.querySelector<HTMLElement>('.fc-timegrid-slot-label')
      if (!label) return
      const minutes =
        slotRange.minMinutes + index * CALENDAR_SLOT_MINUTES
      const previousDay = minutes < 0
      const nextDay = minutes >= 24 * 60
      label.classList.toggle(
        'calendar-adjacent-slot-label-cell',
        previousDay || nextDay,
      )
      label.classList.toggle(
        'calendar-previous-day-slot-label-cell',
        previousDay,
      )
      label.classList.toggle(
        'calendar-next-day-slot-label-cell',
        nextDay,
      )
    })
  }, [groups, calendarHeight, slotRange.maxMinutes, slotRange.minMinutes, zoom, viewType])

  function handleSlotLabelClassNames(arg: SlotLabelContentArg): string[] {
    const offset = localDayOffset(arg.date, logicalViewDay())
    if (offset === -1) {
      return [
        'calendar-adjacent-slot-label-cell',
        'calendar-previous-day-slot-label-cell',
      ]
    }
    if (offset === 1) {
      return [
        'calendar-adjacent-slot-label-cell',
        'calendar-next-day-slot-label-cell',
      ]
    }
    return []
  }

  function handleSlotLabelDidMount(arg: SlotLabelMountArg) {
    const offset = localDayOffset(arg.date, logicalViewDay())
    if (offset === -1 || offset === 1) {
      arg.el.classList.add('calendar-adjacent-slot-label-cell')
      arg.el.classList.add(
        offset === -1
          ? 'calendar-previous-day-slot-label-cell'
          : 'calendar-next-day-slot-label-cell',
      )
    }
  }

  function handleSlotLabelContent(arg: SlotLabelContentArg) {
    const baseDay = logicalViewDay()
    const offset = localDayOffset(arg.date, baseDay)
    if (offset !== -1 && offset !== 1) return arg.text

    return (
      <span
        className="calendar-adjacent-slot-label"
        title={offset < 0 ? 'Previous day' : 'Next day'}
      >
        <span>{arg.text}</span>
        <span className="calendar-adjacent-slot-icon" aria-hidden>
          {offset < 0 ? '↙' : '↗'}
        </span>
      </span>
    )
  }

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
      const base = groupColors.get(task.groupId) ?? groupEventColors()
      const colors = task.empty ? desaturateEventColors(base, 0.5) : base
      return {
        id: `task:${task.taskId}`,
        title: task.title,
        start: task.start.toISOString(),
        end: task.end.toISOString(),
        backgroundColor: colors.backgroundColor,
        borderColor: colors.borderColor,
        // Move only — `editable: true` would re-enable duration resize.
        // Per-event startEditable overrides calendar eventStartEditable.
        startEditable: stackDragEnabled,
        durationEditable: false,
        order: 0,
        classNames: [
          TASK_STACK_CLASS,
          ...durationClass(task.start, task.end),
          ...(task.empty ? ['task-event-empty'] : []),
        ],
        extendedProps: {
          source: 'task',
          taskId: task.taskId,
          groupId: task.groupId,
        },
      }
    })

    return [...google, ...local]
  }, [googleEvents, groupColors, resolvedTaskEvents, showAllDay, stackDragEnabled])

  function handleDatesSet(arg: DatesSetArg) {
    const type = arg.view.type
    const rangeStart = arg.view.currentStart
    const rangeEnd = arg.view.currentEnd
    viewRangeRef.current = { start: rangeStart, end: rangeEnd }
    if (
      type === 'timeGridDay' ||
      type === 'timeGridThreeDay' ||
      type === 'timeGridWeek'
    ) {
      setViewType(type)
      setTitle(formatCalendarRange(rangeStart, rangeEnd, type))
    } else {
      setTitle(arg.view.title)
    }
    const now = new Date()
    setIsOnToday(now >= rangeStart && now < rangeEnd)
    setFarFromTodayOrTomorrow(
      !isTodayOrTomorrow(pickViewDate(rangeStart, rangeEnd, now)),
    )
    syncNavDisabled(rangeStart, rangeEnd)
    onDatesSet(rangeStart, rangeEnd)
    scheduleCalendarHeightSync()
  }

  // Recompute ‹ › when the executing stack's day span changes.
  useEffect(() => {
    const range = viewRangeRef.current
    if (!range) return
    if (!navDayBounds) {
      setPrevDisabled(false)
      setNextDisabled(false)
      return
    }
    setPrevDisabled(
      !canNavigateCalendarRange(range.start, range.end, navDayBounds, 'prev'),
    )
    setNextDisabled(
      !canNavigateCalendarRange(range.start, range.end, navDayBounds, 'next'),
    )
  }, [navDayBounds])

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
    const groupId = arg.event.extendedProps.groupId as string | undefined
    const groupColor = groupId ? groupColors.get(groupId) : undefined
    const groupBg =
      groupColor?.backgroundColor ?? groupEventColors().backgroundColor
    const textStyle = taskEventTextStyle(groupBg)

    return (
      <TaskEventLabel
        timeText={timeText}
        title={arg.event.title}
        clamp
        textStyle={textStyle}
      />
    )
  }

  return (
    <div
      className="calendar-shell"
      ref={shellRef}
      style={{
        ['--task-event-time-ch' as string]: String(TASK_EVENT_TIME_CHARS),
        ['--calendar-slot-label-scale' as string]: String(
          Math.min(1, Math.max(0.7, 0.7 + ((zoom - 0.3) / 0.7) * 0.3)),
        ),
      }}
    >
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
        calendarsLoading={calendarsLoading}
        onPrev={() => calendarRef.current?.getApi().prev()}
        onNext={() => calendarRef.current?.getApi().next()}
        prevDisabled={prevDisabled}
        nextDisabled={nextDisabled}
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
        onDismissMenus={dismissMenus}
      />

      <div
        className={[
          'calendar-body',
          zoom < 1.7 ? 'is-xxs-overflow' : '',
          zoom < 0.9 ? 'is-10m-overflow' : '',
          zoom < 0.5 ? 'is-15m-overflow' : '',
          zoom < 0.4 ? 'is-20m-overflow' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        ref={calendarBodyRef}
        style={{ ['--cal-zoom' as string]: String(zoom) }}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridDay"
          {...(initialDate ? { initialDate } : {})}
          headerToolbar={false}
          views={{
            timeGridThreeDay: {
              type: 'timeGrid',
              duration: { days: 3 },
            },
          }}
          dayHeaders={false}
          height={calendarHeight > 0 ? calendarHeight : '100%'}
          windowResize={syncCalendarHeight}
          nowIndicator
          editable={stackDragEnabled}
          selectable={false}
          eventStartEditable={stackDragEnabled}
          eventDurationEditable={false}
          eventLongPressDelay={TASK_EVENT_LONG_PRESS_MS}
          events={events}
          datesSet={handleDatesSet}
          eventAllow={handleEventAllow}
          eventDragStart={stackDragEnabled ? handleDragStart : undefined}
          eventDragStop={stackDragEnabled ? handleDragStop : undefined}
          eventDrop={stackDragEnabled ? handleDrop : undefined}
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
          slotMinTime={slotRange.min}
          slotMaxTime={slotRange.max}
          slotLabelClassNames={handleSlotLabelClassNames}
          slotLabelDidMount={handleSlotLabelDidMount}
          slotLabelContent={handleSlotLabelContent}
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
