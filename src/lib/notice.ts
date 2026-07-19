export type NoticeKind = 'success' | 'error' | 'info'

export type Notice = {
  kind: NoticeKind
  text: string
}

export function notice(
  kind: NoticeKind,
  text: string,
): Notice {
  return { kind, text }
}
