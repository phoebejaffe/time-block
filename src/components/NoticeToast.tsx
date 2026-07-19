import type { Notice } from '../lib/notice'

export function NoticeToast({ notice }: { notice: Notice }) {
  return (
    <div
      key={notice.id}
      className={`notice-toast notice-toast-${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      <div className="notice-toast-body">
        <p className="notice-toast-text">{notice.text}</p>
        {notice.actionLabel && notice.onAction && (
          <button
            type="button"
            className="notice-toast-action"
            onClick={notice.onAction}
          >
            {notice.actionLabel}
          </button>
        )}
      </div>
      {notice.progressMs != null && notice.progressMs > 0 && (
        <span
          className="notice-toast-progress"
          style={{ animationDuration: `${notice.progressMs}ms` }}
          aria-hidden
        />
      )}
    </div>
  )
}
