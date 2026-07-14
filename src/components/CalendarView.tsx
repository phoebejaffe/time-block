import { useMemo, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { CalendarEvent } from '../lib/calendarApi'
import type { StackAnchor, Task } from '../lib/tasks'
import { resolveStack } from '../lib/tasks'

const TASK_COLOR = '#0f6e56'
const TASK_BORDER = '#0b5341'

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
      classNames: ['task-event'],
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

  function handleEventDrop(arg: EventDropArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (!taskId || !arg.event.start || !arg.oldEvent.start) {
      arg.revert()
      return
    }
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

  return (
    <div className="calendar-shell">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'timeGridDay,timeGridWeek,dayGridMonth',
        }}
        height="100%"
        nowIndicator
        editable
        selectable
        selectMirror
        eventStartEditable
        eventDurationEditable
        events={events}
        datesSet={handleDatesSet}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
        select={handleSelect}
        eventClick={handleEventClick}
        slotMinTime="05:00:00"
        slotMaxTime="24:00:00"
        scrollTime="06:00:00"
        slotDuration="00:15:00"
        slotLabelInterval="01:00:00"
        snapDuration="00:05:00"
        eventMinHeight={0}
        eventShortHeight={0}
        allDaySlot
      />
    </div>
  )
}
