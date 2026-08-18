import {
  isGroupEnabled,
  isTaskDisabled,
  resolveStack,
  type BlockGroup,
} from './tasks'

/** Matches CalendarView `slotMinTime`. */
export const CALENDAR_SLOT_MIN_MINUTES = 5 * 60
/** Matches CalendarView `slotMaxTime`. */
export const CALENDAR_SLOT_MAX_MINUTES = 24 * 60
/** Matches CalendarView `slotDuration`. */
export const CALENDAR_SLOT_MINUTES = 15

export const FIT_PADDING_PX = 16
export const FIT_SCROLL_MS = 500
export const FIT_DEBOUNCE_MS = 250
export const FIT_VISIBLE_PX = 2
/** When zooming out to fit, occupied stacks target this fraction of the view. */
export const FIT_ZOOM_FILL = 0.9

export function clockMinutes(date: Date): number {
  return (
    date.getHours() * 60 +
    date.getMinutes() +
    date.getSeconds() / 60 +
    date.getMilliseconds() / 60_000
  )
}

/** CSS ease-out: starts fast, then decelerates (`1 − (1−t)²`). */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - (1 - x) * (1 - x)
}

/**
 * One frame of a coupled zoom+scroll animation. Scroll is interpolated in
 * zoom-independent content space so the window eases toward the target
 * while slot heights scale.
 */
export function fitAnimFrame(
  t: number,
  fromZoom: number,
  toZoom: number,
  fromScroll: number,
  toScroll: number,
): { zoom: number; scrollTop: number } {
  const e = Math.min(1, Math.max(0, t))
  const zoom = fromZoom + (toZoom - fromZoom) * e
  const contentFrom = fromZoom === 0 ? 0 : fromScroll / fromZoom
  const contentTo = toZoom === 0 ? 0 : toScroll / toZoom
  const content = contentFrom + (contentTo - contentFrom) * e
  return { zoom, scrollTop: content * zoom }
}

/**
 * Union of occupied time for enabled groups, as minutes from local midnight.
 * `endMinutes` may exceed 24h when a stack crosses midnight.
 */
export function enabledPlansTimeRange(
  groups: BlockGroup[],
): { startMinutes: number; endMinutes: number } | null {
  let minMs = Infinity
  let maxMs = -Infinity
  for (const group of groups) {
    if (!isGroupEnabled(group)) continue
    const resolved = resolveStack(group.tasks, group.anchor)
    for (const task of resolved) {
      if (isTaskDisabled(task)) continue
      const start = task.start.getTime()
      const end = task.end.getTime()
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        continue
      }
      if (start < minMs) minMs = start
      if (end > maxMs) maxMs = end
    }
  }
  if (!Number.isFinite(minMs) || maxMs <= minMs) return null
  const startMinutes = clockMinutes(new Date(minMs))
  return {
    startMinutes,
    endMinutes: startMinutes + (maxMs - minMs) / 60_000,
  }
}

/** Stable key for “should we consider a fit pass?” — ignores titles/notes. */
export function enabledPlansFingerprint(groups: BlockGroup[]): string {
  const ids = groups
    .filter(isGroupEnabled)
    .map((g) => g.id)
    .sort()
    .join(',')
  const range = enabledPlansTimeRange(groups)
  if (!range) return `none|${ids}`
  return `${ids}|${range.startMinutes.toFixed(2)}|${range.endMinutes.toFixed(2)}`
}

export function contentYForMinutes(
  minutes: number,
  slotMinMinutes: number,
  slotMaxMinutes: number,
  slotMinutes: number,
  slotHeight: number,
): number {
  const clamped = Math.min(
    slotMaxMinutes,
    Math.max(slotMinMinutes, minutes),
  )
  return ((clamped - slotMinMinutes) / slotMinutes) * slotHeight
}

/**
 * ScrollTop that puts `[rangeTop, rangeBottom]` in view.
 * Centers the range, unless `nowY` can share the viewport — then extra
 * space is kept on the now-indicator side so that bar stays visible.
 * `null` when the range is already fully visible (or an oversized range
 * is already parked at the top).
 */
export function fitScrollTop(
  scrollTop: number,
  viewHeight: number,
  rangeTop: number,
  rangeBottom: number,
  nowY: number | null = null,
  epsilon = FIT_VISIBLE_PX,
  nowPad = 0,
): number | null {
  const rangeHeight = rangeBottom - rangeTop
  if (rangeHeight <= viewHeight) {
    const viewBottom = scrollTop + viewHeight
    if (
      rangeTop >= scrollTop - epsilon &&
      rangeBottom <= viewBottom + epsilon
    ) {
      return null
    }

    const extra = viewHeight - rangeHeight
    const nowFits =
      nowY != null &&
      Math.max(rangeBottom, nowY + nowPad) -
        Math.min(rangeTop, nowY - nowPad) <=
        viewHeight + epsilon

    if (nowFits && nowY < rangeTop - epsilon) {
      return rangeBottom - viewHeight
    }
    if (nowFits && nowY > rangeBottom + epsilon) {
      return rangeTop
    }
    return rangeTop - extra / 2
  }
  if (Math.abs(scrollTop - rangeTop) <= epsilon) return null
  return rangeTop
}

export type PlanFitInput = {
  startMinutes: number
  endMinutes: number
  slotMinMinutes: number
  slotMaxMinutes: number
  slotMinutes: number
  slotHeight: number
  scrollTop: number
  viewHeight: number
  zoom: number
  minZoom: number
  paddingPx: number
  epsilon?: number
  /** Local minutes from midnight of “now”; omitted when outside the grid. */
  nowMinutes?: number
}

export type PlanFit =
  | { kind: 'visible' }
  | { kind: 'scroll'; scrollTop: number }
  | {
      kind: 'zoom'
      zoom: number
      /** Post-zoom scrollTop to animate toward. */
      scrollTop: number
      /** Post-zoom scrollTop that keeps the current top time (animation from). */
      fromScrollTop: number
    }

export function planFit(input: PlanFitInput): PlanFit {
  const {
    startMinutes,
    endMinutes,
    slotMinMinutes,
    slotMaxMinutes,
    slotMinutes,
    slotHeight,
    scrollTop,
    viewHeight,
    zoom,
    minZoom,
    paddingPx,
    epsilon = FIT_VISIBLE_PX,
    nowMinutes,
  } = input

  if (viewHeight <= 0 || slotHeight <= 0 || zoom <= 0) return { kind: 'visible' }

  const y = (minutes: number, height: number) =>
    contentYForMinutes(
      minutes,
      slotMinMinutes,
      slotMaxMinutes,
      slotMinutes,
      height,
    )

  let top = Math.max(0, y(startMinutes, slotHeight) - paddingPx)
  let bot = y(endMinutes, slotHeight) + paddingPx
  const rangeH = bot - top
  if (rangeH <= 0) return { kind: 'visible' }

  let nextZoom = zoom
  let nextSlotH = slotHeight
  if (rangeH > viewHeight + epsilon && zoom > minZoom + 1e-6) {
    const fillH = viewHeight * FIT_ZOOM_FILL
    const fitted = Math.max(minZoom, zoom * (fillH / rangeH))
    if (fitted < zoom - 1e-4) {
      nextZoom = fitted
      nextSlotH = slotHeight * (nextZoom / zoom)
      top = Math.max(0, y(startMinutes, nextSlotH) - paddingPx)
      bot = y(endMinutes, nextSlotH) + paddingPx
    }
  }

  const contentH =
    ((slotMaxMinutes - slotMinMinutes) / slotMinutes) * nextSlotH
  const maxScroll = Math.max(0, contentH - viewHeight)
  const scale = nextSlotH / slotHeight
  const fromScroll = Math.max(0, Math.min(maxScroll, scrollTop * scale))
  const nowOnGrid =
    nowMinutes != null &&
    nowMinutes >= slotMinMinutes &&
    nowMinutes < slotMaxMinutes
  const nowY = nowOnGrid ? y(nowMinutes, nextSlotH) : null
  const raw = fitScrollTop(
    fromScroll,
    viewHeight,
    top,
    bot,
    nowY,
    epsilon,
    paddingPx,
  )
  const target =
    raw == null ? null : Math.max(0, Math.min(maxScroll, raw))

  if (nextZoom < zoom - 1e-4) {
    return {
      kind: 'zoom',
      zoom: nextZoom,
      scrollTop: target ?? fromScroll,
      fromScrollTop: fromScroll,
    }
  }

  if (target == null || Math.abs(target - scrollTop) <= epsilon) {
    return { kind: 'visible' }
  }
  return { kind: 'scroll', scrollTop: target }
}
