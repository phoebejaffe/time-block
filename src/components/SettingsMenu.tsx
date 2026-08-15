import { useEffect, useMemo, useRef, useState } from 'react'
import { HowItWorksModal } from './HowItWorksModal'
import { BlockLibraryModal } from './BlockLibraryModal'
import { AuthSessionDiagnostics } from './AuthSessionDiagnostics'
import type { BlockLibrary } from '../lib/tasks'
import type { NoticeOptions } from '../lib/notice'
import type { SessionDiagnostics } from '../lib/google'
import { hardReloadApp } from '../lib/hardReload'

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
  onOpenArchivedPlans?: () => void
  onShowNotice?: (text: string, options?: NoticeOptions) => void
  onClearNotice?: () => void
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
  onOpenArchivedPlans,
  onShowNotice,
  onClearNotice,
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buildTime = useMemo(() => formatBuildTime(__BUILD_TIME__), [])

  async function shareAppLink() {
    try {
      await navigator.clipboard.writeText(SHARE_APP_URL)
      onShowNotice?.('Link copied.')
    } catch {
      onShowNotice?.("Couldn't copy the link.")
    }
  }

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="settings-menu" ref={menuRef}>
      <button
        type="button"
        className="btn btn-text btn-icon"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="true"
        title="Menu"
        onClick={() => setOpen((v) => !v)}
      >
        <MenuIcon />
      </button>
      {open && (
        <div className="settings-menu-dropdown" role="menu">
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
            Reload App
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
          {authDiagnostics && (
            <AuthSessionDiagnostics
              diagnostics={authDiagnostics}
              signedIn={authSignedIn ?? Boolean(signedIn)}
              testBusy={authTestRefreshBusy}
              onTestRefresh={onAuthTestRefresh}
              compact
            />
          )}
        </div>
      )}
      {helpOpen && <HowItWorksModal onClose={() => setHelpOpen(false)} />}
      {libraryOpen && (
        <BlockLibraryModal
          library={blockLibrary}
          onChange={onReplaceBlockLibrary}
          onClose={() => setLibraryOpen(false)}
          onShowNotice={onShowNotice}
          onClearNotice={onClearNotice}
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
