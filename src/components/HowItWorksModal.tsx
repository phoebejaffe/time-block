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
          <h2 id="how-it-works-title">How Timeblock Works</h2>
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
            For users with ADHD and time blindness, it can be hard to plan a day
            and stay on time without being able to visualize time. Timeblock lets
            you plan out your day, see it visually, make adjustments against
            constraints (like having to catch a bus at a certain time), and
            execute your plan.
          </p>

          <h3>Plan your day</h3>
          <p>
            In the sidebar, build a list of blocks—each one something you want to
            do, and how long it should take. If you want to wake up at a certain
            time and work forward from there—anchor the list with{' '}
            <strong>Starts</strong>. Or maybe you have to catch a bus at 5:30 and
            need everything to finish by then—use <strong>Ends</strong> so the
            whole list packs back from that deadline.
          </p>
          <p>
            Scrub the time by pressing and dragging on the field (on a phone, a
            quick tap still opens the usual picker). Drag a block&apos;s title to
            reorder. Tap a block—or one of your events on the calendar—to edit
            length and title.
          </p>
          <p>
            Need a gap that isn&apos;t a real task? Mark a block empty so it holds
            time without going to Google Calendar. You can also disable a block
            you aren&apos;t doing today.
          </p>
          <p>
            For groups of blocks, you can turn a group off with the power control
            when you don&apos;t want it on the calendar. The ··· menu covers
            naming, color, saving a default list, revert, and clearing or deleting
            a group.
          </p>
          <p>
            When your block list is done, you can save it as a default so you can
            make changes later, but easily return to this version of the list. You
            can also <strong>Add to calendar</strong> (or{' '}
            <strong>Update calendar</strong>) to add it to one or more of your
            Google calendars. Matching blocks show a green check; a grey calendar
            icon means something drifted since the last sync.
          </p>

          <h3>Block library</h3>
          <p>
            For blocks you use frequently—morning routine, deep work, a commute—
            save them in the <strong>Block library</strong> (from the settings
            menu). Organize them into categories, then when you&apos;re building a
            day, tap <strong>Library block</strong> to drop one or more into your
            list without retyping titles and lengths each time.
          </p>

          <h3>Run it</h3>
          <p>
            When you&apos;re ready to execute your plan, enter{' '}
            <strong>execution mode</strong> to help you stay on track.{' '}
            <strong>Execute this plan</strong> appears as an option when the
            current time is within an hour of the block group, so you can open a
            focused view of that one list beside the calendar.
          </p>
          <p>
            Watch <strong>Start</strong> and <strong>Intended End</strong>, and the
            strip that tells you whether you&apos;re ending on time, early, or late.
            Mark blocks finished as you go—tap the pending icon or the row for a
            green check; use the pencil when you need to edit.
          </p>
          <p>
            If you&apos;ve slipped, <strong>I&apos;m delayed</strong> inserts time
            so the rest of the list shifts later—then trim later blocks if you want
            to catch up.
          </p>
          <p>
            Close the view anytime; a banner keeps the run alive so you can jump
            back in. <strong>Stop executing</strong> when you&apos;re done. If
            you&apos;re signed in on another device, you can pick up the same run
            there.
          </p>

          <h3>Calendar</h3>
          <p>
            Your Timeblock events sit on the grid with your other Google Calendar
            events. While you&apos;re planning, drag any block in a stack to slide
            the whole list earlier or later on the same day. Pinch or ⌘/Ctrl-scroll
            to zoom. Use ‹ › to change days, <strong>Today</strong> to jump home,
            and the calendar ··· menu for Day / 3 Day / Week, which calendars to
            show, and all-day events.
          </p>

          <h3>Layout</h3>
          <p>
            On a computer, drag the bar between sidebar and calendar. On a phone,
            drag the bar between plan and calendar to give one side more room.
          </p>
        </div>
      </div>
    </div>
  )
}
