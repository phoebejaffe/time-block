import { useEffect } from 'react'

type HowItWorksModalProps = {
  onClose: () => void
}

export function HowItWorksModal({ onClose }: HowItWorksModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal-dialog modal-dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-it-works-title"
      >
        <div className="modal-header">
          <h2 id="how-it-works-title">How this works</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body help-modal-body">
          <p>
            Everything important syncs to your account. When you&apos;re signed in,
            your block groups (including whether each group <strong>Starts</strong>{' '}
            or <strong>Ends</strong> at a time, and what that time is), your blocks,
            saved lists, calendar choice, and which blocks you&apos;ve added to
            Google Calendar all stay in sync across your devices.
            The app always opens on <strong>today</strong> — it doesn&apos;t remember
            which day you were looking at last time.
          </p>
          <p>
            Only a few things stay on this device: staying signed in, how wide the
            sidebar is on a computer, and on a phone, how much space the plan vs. the
            calendar takes up.
          </p>

          <h3>Planning blocks (sidebar)</h3>
          <p>
            <strong>Setting the time (Starts / Ends)</strong>
          </p>
          <ul>
            <li>
              Tap <strong>Starts</strong> or <strong>Ends</strong> to switch whether
              your blocks are laid out forward from a start time or backward from an
              end time.
            </li>
            <li>
              <strong>Adjust the time by dragging:</strong> press on the time field
              and drag up or down to change it. On a computer, minutes move in{' '}
              <strong>5-minute</strong> steps. If you click near the hour part of
              the time, dragging changes the hour instead.
            </li>
            <li>
              <strong>On your phone:</strong> a quick tap opens the normal time
              picker. If you press and drag up or down instead, the time changes
              without opening the picker.
            </li>
          </ul>
          <p>
            <strong>Reorder blocks</strong> — drag a block&apos;s title row up or down
            to change the order.
          </p>
          <p>
            <strong>Edit a block</strong> — tap the pencil icon, or tap one of your
            blocks on the calendar. While editing:
          </p>
          <ul>
            <li>
              Use the ↑ / ↓ arrow keys to change the length by 5 minutes
            </li>
            <li>
              Drag up or down on the minutes field to change the length the same way
            </li>
            <li>
              <strong>Enter</strong> saves; <strong>Escape</strong> cancels
            </li>
          </ul>
          <p>
            <strong>Delete a block</strong> — use the trash icon; you&apos;ll get a
            short Undo option showing the block name.
          </p>
          <p>
            <strong>Power button</strong> — hides a group from the calendar and
            collapses it in the sidebar. Turn it back on to expand the group again.
          </p>
          <p>
            <strong>Group menu (···)</strong> — Save blocks, Restore blocks, Name
            group, Delete from calendar, or Delete block group.
          </p>
          <p>
            <strong>Add to calendar</strong> — the Add / Update button sends the
            whole stack to your Google Calendar. Your plan stays in Timeblock, and
            you can make changes and update them on Google Calendar by clicking{' '}
            <strong>Update</strong>. Blocks on the calendar for that day show a
            green check when they match; a grey calendar icon means something
            changed since the last sync.
          </p>

          <h3>Calendar</h3>
          <p>
            <strong>Move a whole stack</strong> — drag any of your timeblock events
            on the calendar. The whole group moves together — every block shifts by
            the same amount. You can change the time on the same day, but not move
            blocks to a different day.
          </p>
          <p>
            <strong>Zoom in or out</strong>
          </p>
          <ul>
            <li>
              Pinch on the calendar with two fingers on your phone, or on a Mac
              trackpad
            </li>
            <li>
              Hold Ctrl and scroll (Windows/Linux) or hold ⌘ and scroll (Mac)
            </li>
          </ul>
          <p>
            <strong>Moving between days</strong> — use ‹ › to go to the previous or
            next day. <strong>Today</strong> jumps you back when you&apos;ve moved
            away. A small warning icon beside it appears if you&apos;re looking at
            a day that isn&apos;t today or tomorrow.
          </p>
          <p>
            <strong>Calendar menu (···)</strong> — switch between Day, 3 Day, or Week
            view, choose which Google calendars to show, and turn all-day events on or
            off.
          </p>
          <p>
            <strong>Tap a timeblock on the calendar</strong> — opens that block for
            editing in the sidebar.
          </p>

          <h3>Layout</h3>
          <p>
            <strong>On a computer:</strong> drag the thin bar between the sidebar and
            calendar to make either side wider or narrower.
          </p>
          <p>
            <strong>On your phone:</strong> drag the horizontal bar between the plan
            and the calendar to give more room to one or the other.
          </p>

          <h3>Sync across devices</h3>
          <p>
            Change something on your phone and it should show up on your computer
            within a couple of seconds, and vice versa.
          </p>
        </div>
      </div>
    </div>
  )
}
