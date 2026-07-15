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
import type { CalendarEvent } from '../lib/calendarApi'
import type { StackAnchor, Task } from '../lib/tasks'
import { resolveStack } from '../lib/tasks'

const TASK_COLOR = '#0f6e56'
const TASK_BORDER = '#0b5341'
const NARROW_BREAKPOINT = 560

const TITLE_WIDE: FormatterInput = {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}

const TITLE_NARROW: FormatterInput = {
  month: 'numeric',
  day: 'numeric',
  year: '2-digit',
}

const DAY_HEADER: FormatterInput = {
  month: 'numeric',
  day: 'numeric',
}

type CalendarViewProps = {
  googleEvents: CalendarEvent[]
  tasks: Task[]
  anchor: StackAnchor
  onDatesSet: (start: Date, end: Date) => void
  onStackShift: (deltaMs: number) => void
  onTaskDurationChange: (taskId: string, durationMinutes: number) => void
  onSelectSlot?: (start: Date, end: Date) => void
  onTaskClick?: (taskId: string) => void
}

const TASK_STACK_CLASS = 'task-event'

type StackDragState = {
  taskId: string
  subjectEl: HTMLElement
  originTop: number
  originLeft: number
}

export function CalendarView({
  googleEvents,
  tasks,
  anchor,
  onDatesSet,
  onStackShift,
  onTaskDurationChange,
  onSelectSlot,
  onTaskClick,
}: CalendarViewProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const stackDragRef = useRef<StackDragState | null>(null)
  const stackDragRafRef = useRef<number | null>(null)
  const [narrow, setNarrow] = useState(false)

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
    return () => {
      stopStackDragTracking()
      clearStackDragTransforms()
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
    const api = calendarRef.current?.getApi()
    if (api?.view.type === 'timeGridWeek') {
      api.changeView('timeGridThreeDay')
    }
  }, [narrow])

  const events = useMemo((): EventInput[] => {
    const google: EventInput[] = googleEvents.map((e) => ({
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
  }, [googleEvents, tasks, anchor])

  function handleDatesSet(arg: DatesSetArg) {
    onDatesSet(arg.start, arg.end)
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
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: narrow
            ? 'timeGridDay,timeGridThreeDay'
            : 'timeGridDay,timeGridThreeDay,timeGridWeek',
        }}
        views={{
          timeGridThreeDay: {
            type: 'timeGrid',
            duration: { days: 3 },
            buttonText: '3 Day',
          },
        }}
        buttonText={{
          today: '',
          day: 'Day',
          week: 'Week',
        }}
        buttonHints={{
          today: 'Today',
        }}
        titleFormat={narrow ? TITLE_NARROW : TITLE_WIDE}
        dayHeaderFormat={DAY_HEADER}
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
        allDaySlot
        dayMaxEvents={0}
        moreLinkClick="popover"
      />
    </div>
  )
}
