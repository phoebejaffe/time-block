type AuthButtonProps = {
  signedIn: boolean
  busy: boolean
  onSignIn: () => void
  onSignOut: () => void
}

export function AuthButton({
  signedIn,
  busy,
  onSignIn,
  onSignOut,
}: AuthButtonProps) {
  if (signedIn) {
    return <SignOutButton busy={busy} onSignOut={onSignOut} />
  }

  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={onSignIn}
      disabled={busy}
    >
      {busy ? 'Connecting…' : 'Sign in with Google'}
    </button>
  )
}

export function SignOutButton({
  busy,
  onSignOut,
}: {
  busy?: boolean
  onSignOut: () => void
}) {
  return (
    <button
      type="button"
      className="btn btn-text btn-icon"
      onClick={onSignOut}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
    >
      <SignOutIcon />
    </button>
  )
}

function SignOutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2v10" />
      <path d="M18.4 6.6a8 8 0 1 1-12.8 0" />
    </svg>
  )
}
