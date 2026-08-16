/**
 * Close an open menu on outside mousedown (capture phase) without activating
 * the control underneath. Escape still closes via a separate keydown listener.
 *
 * Native `<input type="color">` pickers live outside the DOM; while that
 * input is focused we treat interaction as inside the menu so choosing a
 * color does not dismiss it.
 *
 * Cancelling mousedown is not enough in Chromium — the later `click` still
 * fires — so the dismiss click is swallowed separately. That listener is
 * `{ once: true }` and must outlive this subscription: `close()` unmounts
 * the menu and would otherwise remove it before `click` runs.
 */
export function isMenuColorPickerActive(
  isInside: (target: Node) => boolean,
): boolean {
  const active = document.activeElement
  return (
    active instanceof HTMLInputElement &&
    active.type === 'color' &&
    isInside(active)
  )
}

function swallowNextClick() {
  function onClick(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }
  document.addEventListener('click', onClick, { capture: true, once: true })
}

export function subscribeMenuOutsideClose(
  isInside: (target: Node) => boolean,
  close: () => void,
): () => void {
  function onPointerDown(event: MouseEvent) {
    const target = event.target
    if (!(target instanceof Node)) return
    if (isInside(target)) return
    if (isMenuColorPickerActive(isInside)) return
    event.preventDefault()
    event.stopPropagation()
    swallowNextClick()
    close()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') close()
  }

  document.addEventListener('mousedown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown)
  return () => {
    document.removeEventListener('mousedown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown)
  }
}

