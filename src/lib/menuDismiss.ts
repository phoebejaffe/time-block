/**
 * Close an open menu on outside mousedown (capture phase) without activating
 * the control underneath. Escape still closes via a separate keydown listener.
 */
export function subscribeMenuOutsideClose(
  isInside: (target: Node) => boolean,
  close: () => void,
): () => void {
  function onPointerDown(event: MouseEvent) {
    const target = event.target
    if (!(target instanceof Node)) return
    if (isInside(target)) return
    event.preventDefault()
    event.stopPropagation()
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
