export type NoticeKind = 'success' | 'error' | 'info'

export type Notice = {
  id: string
  kind: NoticeKind
  text: string
  actionLabel?: string
  onAction?: () => void
  /** When set, show a draining progress bar for this many ms. */
  progressMs?: number
}

export type NoticeOptions = {
  actionLabel?: string
  onAction?: () => void
  progressMs?: number
  /** When true, do not auto-dismiss (useful for in-progress status). */
  persist?: boolean
}

export function notice(
  kind: NoticeKind,
  text: string,
  options?: NoticeOptions,
): Notice {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    text,
    actionLabel: options?.actionLabel,
    onAction: options?.onAction,
    progressMs: options?.progressMs,
  }
}
