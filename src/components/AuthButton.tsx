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
    return (
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onSignOut}
        disabled={busy}
      >
        Sign out
      </button>
    )
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
