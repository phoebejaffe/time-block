import { useMemo, useRef, useState } from 'react'
import { HowItWorksModal } from './HowItWorksModal'
import { BlockLibraryModal } from './BlockLibraryModal'
import { FixedMenuPortal } from './FixedMenuPortal'
import { SettingsModal } from './SettingsModal'
import type { BlockLibrary, Plan } from '../lib/tasks'
import type { PlanArchive } from '../lib/planArchive'
import type { SavedCalendarUser } from '../lib/savedCalendarUsers'
import type { NoticeOptions } from '../lib/notice'
import type { SessionDiagnostics } from '../lib/google'
import type { GoogleCalendar } from '../lib/calendarApi'
import type { UserSettings } from '../lib/userSettings'
import { hardReloadApp } from '../lib/hardReload'
import { useFixedMenu } from '../hooks/useFixedMenu'

type SettingsMenuProps = {
  busy?: boolean
  signedIn?: boolean
  onSignIn?: () => void
  onSignOut?: () => void
  authDiagnostics?: SessionDiagnostics
  authSignedIn?: boolean
  authTestRefreshBusy?: boolean
  onAuthTestRefresh?: () => void
  blockLibrary: BlockLibrary
  onReplaceBlockLibrary: (library: BlockLibrary) => void
  plan: Plan
  onReplacePlan: (plan: Plan) => void
  planArchive: PlanArchive
  onReplacePlanArchive: (archive: PlanArchive) => void
  onOpenArchivedPlans?: () => void
  onShowNotice?: (text: string, options?: NoticeOptions) => void
  onClearNotice?: () => void
  savedCalendarUsers: SavedCalendarUser[]
  onReplaceSavedCalendarUsers: (users: SavedCalendarUser[]) => void
  settings: UserSettings
  onReplaceSettings: (settings: UserSettings) => void
  targetCalendarId: string
  onTargetCalendarChange: (id: string) => void
  calendars: GoogleCalendar[]
  writableCalendars: GoogleCalendar[]
}

const SHARE_APP_URL = 'https://phoebejaffe.github.io/time-block/'

function formatBuildTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
  return `Build time: ${date} at ${time}`
}

export function SettingsMenu({
  busy,
  signedIn,
  onSignIn,
  onSignOut,
  authDiagnostics,
  authSignedIn,
  authTestRefreshBusy,
  onAuthTestRefresh,
  blockLibrary,
  onReplaceBlockLibrary,
  plan,
  onReplacePlan,
  planArchive,
  onReplacePlanArchive,
  onOpenArchivedPlans,
  onShowNotice,
  onClearNotice,
  savedCalendarUsers,
  onReplaceSavedCalendarUsers,
  settings,
  onReplaceSettings,
  targetCalendarId,
  onTargetCalendarChange,
  calendars,
  writableCalendars,
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menu = useFixedMenu({
    open,
    align: 'end',
    constrainHeight: true,
    onClose: () => setOpen(false),
  })
  const buildTime = useMemo(() => formatBuildTime(__BUILD_TIME__), [])

  async function shareAppLink() {
    try {
      await navigator.clipboard.writeText(SHARE_APP_URL)
      onShowNotice?.('Link copied.')
    } catch {
      onShowNotice?.("Couldn't copy the link.")
    }
  }

  return (
    <div className="settings-menu" ref={menuRef}>
      <button
        type="button"
        ref={menu.triggerRef}
        className="btn btn-text btn-icon"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="true"
        title="Menu"
        onClick={() => setOpen((v) => !v)}
      >
        <MenuIcon />
      </button>
      <FixedMenuPortal
        open={open}
        dropdownRef={menu.dropdownRef}
        style={menu.style}
        className="settings-menu-dropdown"
      >
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          onClick={() => {
            setOpen(false)
            setLibraryOpen(true)
          }}
        >
          Block library
        </button>
        {onOpenArchivedPlans && (
          <button
            type="button"
            role="menuitem"
            className="calendar-menu-item"
            onClick={() => {
              setOpen(false)
              onOpenArchivedPlans()
            }}
          >
            Archived plans
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          onClick={() => {
            setOpen(false)
            setSettingsOpen(true)
          }}
        >
          Settings
        </button>
        <div className="calendar-menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          onClick={() => {
            setOpen(false)
            setHelpOpen(true)
          }}
        >
          How Time Block works
        </button>
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          onClick={() => {
            setOpen(false)
            void shareAppLink()
          }}
        >
          Share app
        </button>
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          onClick={() => {
            setOpen(false)
            void hardReloadApp()
          }}
        >
          Reload app
        </button>
        {signedIn
          ? onSignOut && (
              <button
                type="button"
                role="menuitem"
                className="calendar-menu-item"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
              >
                Log out
              </button>
            )
          : onSignIn && (
              <button
                type="button"
                role="menuitem"
                className="calendar-menu-item"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  onSignIn()
                }}
              >
                Log in
              </button>
            )}
        <div className="calendar-menu-sep" role="separator" />
        <p className="settings-menu-build">{buildTime}</p>
      </FixedMenuPortal>
      {helpOpen && <HowItWorksModal onClose={() => setHelpOpen(false)} />}
      {libraryOpen && (
        <BlockLibraryModal
          library={blockLibrary}
          onChange={onReplaceBlockLibrary}
          onClose={() => setLibraryOpen(false)}
          onShowNotice={onShowNotice}
          onClearNotice={onClearNotice}
          majorUndoSeconds={settings.majorUndoSeconds}
          quickUndoSeconds={settings.quickUndoSeconds}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChangeSettings={onReplaceSettings}
          targetCalendarId={targetCalendarId}
          onTargetCalendarChange={onTargetCalendarChange}
          calendars={calendars}
          writableCalendars={writableCalendars}
          savedUsers={savedCalendarUsers}
          onChangeSavedUsers={onReplaceSavedCalendarUsers}
          blockLibrary={blockLibrary}
          onReplaceBlockLibrary={onReplaceBlockLibrary}
          plan={plan}
          onReplacePlan={onReplacePlan}
          planArchive={planArchive}
          onReplacePlanArchive={onReplacePlanArchive}
          onShowNotice={(text) => onShowNotice?.(text)}
          authDiagnostics={authDiagnostics}
          authSignedIn={authSignedIn}
          authTestRefreshBusy={authTestRefreshBusy}
          onAuthTestRefresh={onAuthTestRefresh}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

function MenuIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}
