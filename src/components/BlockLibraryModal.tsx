import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  BlockLibrary,
  BlockLibraryCategory,
  SavedBlock,
} from '../lib/tasks'
import {
  createSavedBlock,
  formatDurationMinutes,
  isTaskEmpty,
  touchBlockLibrary,
} from '../lib/tasks'
import { TaskFieldsForm } from './TaskFieldsForm'
import { EditIcon, TrashIcon } from './icons'
import { FixedMenuPortal } from './FixedMenuPortal'
import type { NoticeOptions } from '../lib/notice'
import { undoNoticeOptions } from '../lib/notice'
import { useFixedMenu } from '../hooks/useFixedMenu'

const DRAG_ACTIVATE_PX = 5

type BlockLibraryModalProps = {
  library: BlockLibrary
  onChange: (library: BlockLibrary) => void
  onClose: () => void
  onShowNotice?: (text: string, options?: NoticeOptions) => void
  onClearNotice?: () => void
  focusBlockId?: string
  quickUndoSeconds?: number
  majorUndoSeconds?: number
}

export function BlockLibraryModal({
  library,
  onChange,
  onClose,
  onShowNotice,
  onClearNotice,
  focusBlockId,
  quickUndoSeconds = 5,
  majorUndoSeconds = 10,
}: BlockLibraryModalProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(
    null,
  )
  const [categoryNameInput, setCategoryNameInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const [highlightBlockId, setHighlightBlockId] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!focusBlockId) return
    const el = bodyRef.current?.querySelector(
      `[data-block-id="${CSS.escape(focusBlockId)}"]`,
    )
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setHighlightBlockId(focusBlockId)
    const timeout = window.setTimeout(() => {
      setHighlightBlockId((id) => (id === focusBlockId ? null : id))
    }, 6000)
    return () => window.clearTimeout(timeout)
  }, [focusBlockId])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function commitCategories(categories: BlockLibraryCategory[]) {
    onChange(touchBlockLibrary(categories))
  }

  function updateCategory(
    categoryId: string,
    updater: (category: BlockLibraryCategory) => BlockLibraryCategory,
  ) {
    commitCategories(
      library.categories.map((c) => (c.id === categoryId ? updater(c) : c)),
    )
  }

  function addCategory() {
    const category: BlockLibraryCategory = {
      id: crypto.randomUUID(),
      name: 'New category',
      blocks: [],
    }
    commitCategories([...library.categories, category])
  }

  function removeCategory(categoryId: string) {
    const index = library.categories.findIndex((c) => c.id === categoryId)
    const category = index >= 0 ? library.categories[index] : undefined
    if (!category || index < 0) return
    const label = category.name.trim() || 'Untitled'
    if (!window.confirm(`Delete "${label}" and all its blocks?`)) return
    const previousCategories = library.categories
    commitCategories(previousCategories.filter((c) => c.id !== categoryId))
    if (editingKey?.startsWith(`${categoryId}:`)) setEditingKey(null)
    onShowNotice?.(`“${label}” category deleted`, {
      ...undoNoticeOptions(majorUndoSeconds, () => {
        commitCategories(previousCategories)
        onClearNotice?.()
      }),
    })
  }

  function moveCategory(categoryId: string, direction: -1 | 1) {
    const idx = library.categories.findIndex((c) => c.id === categoryId)
    const nextIdx = idx + direction
    if (idx < 0 || nextIdx < 0 || nextIdx >= library.categories.length) return
    const next = [...library.categories]
    const [moved] = next.splice(idx, 1)
    if (!moved) return
    next.splice(nextIdx, 0, moved)
    commitCategories(next)
  }

  function addBlock(categoryId: string) {
    const block = createSavedBlock({ title: '', durationMinutes: 15 })
    updateCategory(categoryId, (c) => ({
      ...c,
      blocks: [...c.blocks, block],
    }))
    setEditingKey(`${categoryId}:${block.id}`)
  }

  function updateBlock(
    categoryId: string,
    blockId: string,
    next: Omit<SavedBlock, 'id'>,
  ) {
    updateCategory(categoryId, (c) => ({
      ...c,
      blocks: c.blocks.map((b) =>
        b.id === blockId
          ? createSavedBlock({
              id: blockId,
              title: next.title,
              durationMinutes: next.durationMinutes,
              empty: next.empty,
            })
          : b,
      ),
    }))
  }

  function discardBlock(categoryId: string, blockId: string) {
    updateCategory(categoryId, (c) => ({
      ...c,
      blocks: c.blocks.filter((b) => b.id !== blockId),
    }))
    if (editingKey === `${categoryId}:${blockId}`) setEditingKey(null)
  }

  function removeBlock(categoryId: string, blockId: string) {
    const category = library.categories.find((c) => c.id === categoryId)
    const index = category?.blocks.findIndex((b) => b.id === blockId) ?? -1
    const block = index >= 0 ? category!.blocks[index] : undefined
    if (!block) return

    updateCategory(categoryId, (c) => ({
      ...c,
      blocks: c.blocks.filter((b) => b.id !== blockId),
    }))
    if (editingKey === `${categoryId}:${blockId}`) setEditingKey(null)

    const label = isTaskEmpty(block)
      ? 'Empty block'
      : `"${block.title.trim() || 'Untitled'}"`
    onShowNotice?.(`${label} deleted`, {
      ...undoNoticeOptions(quickUndoSeconds, () => {
        updateCategory(categoryId, (c) => {
          const blocks = [...c.blocks]
          blocks.splice(index, 0, block)
          return { ...c, blocks }
        })
        onClearNotice?.()
      }),
    })
  }

  function reorderBlocks(
    categoryId: string,
    fromIndex: number,
    toIndex: number,
  ) {
    if (fromIndex === toIndex) return
    updateCategory(categoryId, (c) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= c.blocks.length ||
        toIndex >= c.blocks.length
      ) {
        return c
      }
      const blocks = [...c.blocks]
      const [moved] = blocks.splice(fromIndex, 1)
      if (!moved) return c
      blocks.splice(toIndex, 0, moved)
      return { ...c, blocks }
    })
  }

  function openRenameCategory(categoryId: string) {
    const category = library.categories.find((c) => c.id === categoryId)
    if (!category) return
    setRenamingCategoryId(categoryId)
    setCategoryNameInput(category.name)
  }

  function closeRenameCategory() {
    setRenamingCategoryId(null)
    setCategoryNameInput('')
  }

  function handleRenameCategory(e: React.FormEvent) {
    e.preventDefault()
    if (!renamingCategoryId) return
    updateCategory(renamingCategoryId, (c) => ({
      ...c,
      name: categoryNameInput.trim() || 'Untitled',
    }))
    closeRenameCategory()
  }

  const renamingCategory = renamingCategoryId
    ? library.categories.find((c) => c.id === renamingCategoryId)
    : null

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal-dialog modal-dialog-wide block-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Block library"
      >
        <div className="modal-header">
          <h2>Block library</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="block-library-body" ref={bodyRef}>
          {library.categories.length === 0 ? (
            <p className="muted block-library-empty">
              No categories yet. Add one to start building your library.
            </p>
          ) : (
            library.categories.map((category, categoryIndex) => (
              <CategorySection
                key={category.id}
                category={category}
                editingKey={editingKey}
                onEditingKeyChange={setEditingKey}
                canMoveUp={categoryIndex > 0}
                canMoveDown={categoryIndex < library.categories.length - 1}
                onOpenRename={() => openRenameCategory(category.id)}
                onMoveUp={() => moveCategory(category.id, -1)}
                onMoveDown={() => moveCategory(category.id, 1)}
                onDelete={() => removeCategory(category.id)}
                onAddBlock={() => addBlock(category.id)}
                onUpdateBlock={(blockId, next) =>
                  updateBlock(category.id, blockId, next)
                }
                onRemoveBlock={(blockId) => removeBlock(category.id, blockId)}
                onDiscardBlock={(blockId) => discardBlock(category.id, blockId)}
                onReorderBlocks={(from, to) =>
                  reorderBlocks(category.id, from, to)
                }
                highlightBlockId={highlightBlockId}
              />
            ))
          )}

          <button
            type="button"
            className="task-new-trigger block-library-add-category"
            onClick={addCategory}
          >
            New category +
          </button>
        </div>
      </div>

      {renamingCategory && (
        <div
          className="modal-backdrop modal-backdrop-nested"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeRenameCategory()
          }}
        >
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Rename category"
          >
            <div className="modal-header">
              <h2>Rename category</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={closeRenameCategory}
              >
                ×
              </button>
            </div>
            <form className="modal-form" onSubmit={handleRenameCategory}>
              <label>
                <span>Name</span>
                <input
                  value={categoryNameInput}
                  onChange={(e) => setCategoryNameInput(e.target.value)}
                  placeholder="Morning"
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={closeRenameCategory}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function CategorySection({
  category,
  editingKey,
  onEditingKeyChange,
  canMoveUp,
  canMoveDown,
  onOpenRename,
  onMoveUp,
  onMoveDown,
  onDelete,
  onAddBlock,
  onUpdateBlock,
  onRemoveBlock,
  onDiscardBlock,
  onReorderBlocks,
  highlightBlockId,
}: {
  category: BlockLibraryCategory
  editingKey: string | null
  onEditingKeyChange: (key: string | null) => void
  canMoveUp: boolean
  canMoveDown: boolean
  onOpenRename: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onAddBlock: () => void
  onUpdateBlock: (blockId: string, next: Omit<SavedBlock, 'id'>) => void
  onRemoveBlock: (blockId: string) => void
  onDiscardBlock: (blockId: string) => void
  onReorderBlocks: (fromIndex: number, toIndex: number) => void
  highlightBlockId: string | null
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = useFixedMenu({
    open: menuOpen,
    align: 'end',
    onClose: () => setMenuOpen(false),
  })
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)
  const dropLineIndexRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)

  function blockKey(blockId: string) {
    return `${category.id}:${blockId}`
  }

  function lineIndexFromY(clientY: number): number {
    const list = listRef.current
    if (!list) return 0
    const cards = list.querySelectorAll<HTMLElement>('[data-block-index]')
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i]!.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return i
    }
    return cards.length
  }

  function handleDropAt(insertAt: number, fromIndex: number) {
    let toIndex = insertAt
    if (fromIndex < insertAt) toIndex -= 1
    if (toIndex === fromIndex) return
    onReorderBlocks(fromIndex, toIndex)
  }

  function beginBlockDrag(
    e: React.PointerEvent<HTMLElement>,
    index: number,
  ) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const handle = e.currentTarget
    const pointerId = e.pointerId
    const startX = e.clientX
    const startY = e.clientY
    let active = false
    let cancelled = false

    try {
      handle.setPointerCapture(pointerId)
    } catch {
      /* ignore */
    }

    const endReorderSession = () => {
      document.body.classList.remove('is-task-reordering')
      setDragIndex(null)
      setDropLineIndex(null)
      dropLineIndexRef.current = null
    }

    const activate = () => {
      if (cancelled || active) return
      active = true
      dropLineIndexRef.current = index
      setDragIndex(index)
      setDropLineIndex(index)
      document.body.classList.add('is-task-reordering')
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || cancelled) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!active) {
        if (Math.hypot(dx, dy) < DRAG_ACTIVATE_PX) return
        activate()
      }
      ev.preventDefault()
      const nextLine = lineIndexFromY(ev.clientY)
      if (dropLineIndexRef.current !== nextLine) {
        dropLineIndexRef.current = nextLine
        setDropLineIndex(nextLine)
      }
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      if (active) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
        handleDropAt(
          dropLineIndexRef.current ?? lineIndexFromY(ev.clientY),
          index,
        )
      }
      endReorderSession()
      cleanupListeners()
    }

    const cleanupListeners = () => {
      cancelled = true
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      try {
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId)
        }
      } catch {
        /* ignore */
      }
    }

    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  return (
    <section className="block-library-category">
      <div className="block-library-category-header">
        <h3 className="block-library-category-title">
          {category.name.trim() || 'Untitled'}
        </h3>
        <div className="task-new-menu block-library-category-menu" ref={menuRef}>
          <button
            type="button"
            ref={menu.triggerRef}
            className="btn btn-text btn-icon task-new-menu-btn"
            aria-label="Category options"
            aria-expanded={menuOpen}
            aria-haspopup="true"
            onClick={() => setMenuOpen((open) => !open)}
          >
            ···
          </button>
          <FixedMenuPortal
            open={menuOpen}
            dropdownRef={menu.dropdownRef}
            style={menu.style}
            className="task-new-menu-dropdown is-over-modal"
          >
              <button
                type="button"
                role="menuitem"
                className="calendar-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  onOpenRename()
                }}
              >
                Rename
              </button>
              {(canMoveUp || canMoveDown) && (
                <>
                  <div className="calendar-menu-sep" role="separator" />
                  {canMoveUp && (
                    <button
                      type="button"
                      role="menuitem"
                      className="calendar-menu-item"
                      onClick={() => {
                        setMenuOpen(false)
                        onMoveUp()
                      }}
                    >
                      Move up
                    </button>
                  )}
                  {canMoveDown && (
                    <button
                      type="button"
                      role="menuitem"
                      className="calendar-menu-item"
                      onClick={() => {
                        setMenuOpen(false)
                        onMoveDown()
                      }}
                    >
                      Move down
                    </button>
                  )}
                </>
              )}
              <div className="calendar-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="calendar-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  onDelete()
                }}
              >
                Delete category
              </button>
          </FixedMenuPortal>
        </div>
      </div>

      <ul className="task-list block-library-list" ref={listRef}>
        {category.blocks.map((block, index) => {
          const key = blockKey(block.id)
          const editing = editingKey === key
          const showLineBefore =
            dropLineIndex === index &&
            dragIndex !== null &&
            dropLineIndex !== dragIndex &&
            dropLineIndex !== dragIndex + 1

          return (
            <li
              key={block.id}
              data-block-index={index}
              data-block-id={block.id}
              className={[
                'task-card',
                dragIndex === index ? 'is-dragging' : '',
                showLineBefore ? 'drop-line-before' : '',
                editing ? 'is-editing' : '',
                isTaskEmpty(block) && !editing ? 'task-card-empty' : '',
                highlightBlockId === block.id ? 'is-just-added' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {editing ? (
                <TaskFieldsForm
                  initialTitle={block.title}
                  initialDuration={block.durationMinutes}
                  initialEmpty={block.empty === true}
                  submitLabel="Save"
                  onCancel={() => {
                    if (!block.title.trim()) onDiscardBlock(block.id)
                    else onEditingKeyChange(null)
                  }}
                  onSubmit={(next) => {
                    onUpdateBlock(block.id, next)
                    onEditingKeyChange(null)
                  }}
                />
              ) : (
                <>
                  <div
                    className="task-card-main task-card-drag"
                    onPointerDown={(e) => beginBlockDrag(e, index)}
                    onClick={() => {
                      if (suppressClickRef.current) return
                      onEditingKeyChange(key)
                    }}
                  >
                    <span className="task-title">
                      <span className="task-title-text">
                        {block.title.trim() || 'Untitled'}
                      </span>
                      <span className="muted task-duration">
                        · {formatDurationMinutes(block.durationMinutes)}
                      </span>
                    </span>
                  </div>
                  <div className="task-card-icons">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Edit ${block.title}`}
                      title="Edit"
                      onClick={() => {
                        if (suppressClickRef.current) return
                        onEditingKeyChange(key)
                      }}
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${block.title}`}
                      title="Remove"
                      onClick={() => {
                        if (suppressClickRef.current) return
                        onRemoveBlock(block.id)
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        className="task-new-trigger block-library-add-block"
        onClick={onAddBlock}
      >
        New block +
      </button>
    </section>
  )
}
