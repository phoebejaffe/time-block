export function EditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

export function LibraryIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 30 30"
      fill="currentColor"
      aria-hidden
    >
      <rect x="3" y="3" width="4" height="24" rx="2" ry="2" />
      <rect x="9" y="3" width="4" height="24" rx="2" ry="2" />
      <rect
        x="18"
        y="3"
        width="4"
        height="24"
        rx="2"
        ry="2"
        transform="rotate(-20 20 15)"
      />
    </svg>
  )
}

export function BlockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden
    >
      <path d="M30.133 1.552c-1.090-1.044-2.291-1.573-3.574-1.573-2.006 0-3.47 1.296-3.87 1.693-0.564 0.558-19.786 19.788-19.786 19.788-0.126 0.126-0.217 0.284-0.264 0.456-0.433 1.602-2.605 8.71-2.627 8.782-0.112 0.364-0.012 0.761 0.256 1.029 0.193 0.192 0.45 0.295 0.713 0.295 0.104 0 0.208-0.016 0.31-0.049 0.073-0.024 7.41-2.395 8.618-2.756 0.159-0.048 0.305-0.134 0.423-0.251 0.763-0.754 18.691-18.483 19.881-19.712 1.231-1.268 1.843-2.59 1.819-3.925-0.025-1.319-0.664-2.589-1.901-3.776zM22.37 4.87c0.509 0.123 1.711 0.527 2.938 1.765 1.24 1.251 1.575 2.681 1.638 3.007-3.932 3.912-12.983 12.867-16.551 16.396-0.329-0.767-0.862-1.692-1.719-2.555-1.046-1.054-2.111-1.649-2.932-1.984 3.531-3.532 12.753-12.757 16.625-16.628zM4.387 23.186c0.55 0.146 1.691 0.57 2.854 1.742 0.896 0.904 1.319 1.9 1.509 2.508-1.39 0.447-4.434 1.497-6.367 2.121 0.573-1.886 1.541-4.822 2.004-6.371zM28.763 7.824c-0.041 0.042-0.109 0.11-0.19 0.192-0.316-0.814-0.87-1.86-1.831-2.828-0.981-0.989-1.976-1.572-2.773-1.917 0.068-0.067 0.12-0.12 0.141-0.14 0.114-0.113 1.153-1.106 2.447-1.106 0.745 0 1.477 0.34 2.175 1.010 0.828 0.795 1.256 1.579 1.27 2.331 0.014 0.768-0.404 1.595-1.24 2.458z" />
    </svg>
  )
}

/** Circle with three dots — block not finished yet (Carbon / SVG Repo pending). */
export function PendingIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="9" cy="16" r="2" />
      <circle cx="23" cy="16" r="2" />
      <circle cx="16" cy="16" r="2" />
      <path d="M16,30A14,14,0,1,1,30,16,14.0158,14.0158,0,0,1,16,30ZM16,4A12,12,0,1,0,28,16,12.0137,12.0137,0,0,0,16,4Z" />
    </svg>
  )
}

/** Check mark for a finished block. */
export function FinishedCheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/** Clock with progress rays — “I’m delayed”. */
export function DelayedIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      aria-hidden
    >
      <g fill="currentColor">
        <path d="M1.5 8a6.5 6.5 0 016.744-6.496.75.75 0 10.055-1.499 8 8 0 107.036 11.193.75.75 0 00-1.375-.6 6.722 6.722 0 01-.22.453A6.5 6.5 0 011.5 8zM10.726 1.238a.75.75 0 011.013-.312c.177.094.35.194.518.3a.75.75 0 01-.799 1.27 6.512 6.512 0 00-.42-.244.75.75 0 01-.312-1.014zM13.74 3.508a.75.75 0 011.034.235c.106.168.206.34.3.518a.75.75 0 11-1.326.702 6.452 6.452 0 00-.243-.421.75.75 0 01.235-1.034zM15.217 6.979a.75.75 0 01.777.722 8.034 8.034 0 01.002.552.75.75 0 01-1.5-.047 6.713 6.713 0 000-.45.75.75 0 01.721-.777z" />
        <path d="M7.75 3a.75.75 0 01.75.75v3.786l2.085 1.043a.75.75 0 11-.67 1.342l-2.5-1.25A.75.75 0 017 8V3.75A.75.75 0 017.75 3z" />
      </g>
    </svg>
  )
}
