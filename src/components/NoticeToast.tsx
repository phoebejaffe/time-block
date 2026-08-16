import type { Notice } from '../lib/notice'

export function NoticeToast({ notice }: { notice: Notice }) {
  const hasProgress = notice.progress != null
  const progressPct =
    notice.progress != null
      ? Math.min(
          100,
          (notice.progress.current / Math.max(notice.progress.total, 1)) * 100,
        )
      : 0

  return (
    <div
      key={notice.id}
      className={[
        'notice-toast',
        `notice-toast-${notice.kind}`,
        hasProgress ? 'notice-toast-busy' : '',
      ]
        .filter(Boolean)
        .join(' ')}
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
      {hasProgress && notice.progress && (
        <div
          className="notice-toast-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={notice.progress.total}
          aria-valuenow={notice.progress.current}
        >
          <div
            className="notice-toast-progress-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
      {!hasProgress && notice.progressMs != null && notice.progressMs > 0 && (
        <span
          className="notice-toast-progress"
          style={{ animationDuration: `${notice.progressMs}ms` }}
          aria-hidden
        />
      )}
    </div>
  )
}
