import { useEffect, useRef, useState } from 'react'
import type {
  BlockLibrary,
  BlockLibraryCategory,
  SavedBlock,
} from '../lib/tasks'
import {
  createSavedBlock,
  isTaskEmpty,
  touchBlockLibrary,
} from '../lib/tasks'
import { TaskFieldsForm } from './TaskFieldsForm'

const DRAG_ACTIVATE_PX = 5

type BlockLibraryModalProps = {
  library: BlockLibrary
  onChange: (library: BlockLibrary) => void
  onClose: () => void
}

export function BlockLibraryModal({
  library,
  onChange,
  onClose,
}: BlockLibraryModalProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)

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
    if (!window.confirm('Delete this category and all its blocks?')) return
    commitCategories(library.categories.filter((c) => c.id !== categoryId))
    if (editingKey?.startsWith(`${categoryId}:`)) setEditingKey(null)
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

  function removeBlock(categoryId: string, blockId: string) {
    updateCategory(categoryId, (c) => ({
      ...c,
      blocks: c.blocks.filter((b) => b.id !== blockId),
    }))
    if (editingKey === `${categoryId}:${blockId}`) setEditingKey(null)
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

        <div className="block-library-body">
          {library.categories.length === 0 ? (
            <p className="muted block-library-empty">
              No categories yet. Add one to start building your library.
            </p>
          ) : (
            library.categories.map((category, categoryIndex) => (
              <CategorySection
                key={category.id}
                category={category}
                categoryIndex={categoryIndex}
                categoryCount={library.categories.length}
                editingKey={editingKey}
                onEditingKeyChange={setEditingKey}
                onRename={(name) =>
                  updateCategory(category.id, (c) => ({ ...c, name }))
                }
                onMoveUp={() => moveCategory(category.id, -1)}
                onMoveDown={() => moveCategory(category.id, 1)}
                onDelete={() => removeCategory(category.id)}
                onAddBlock={() => addBlock(category.id)}
                onUpdateBlock={(blockId, next) =>
                  updateBlock(category.id, blockId, next)
                }
                onRemoveBlock={(blockId) => removeBlock(category.id, blockId)}
                onReorderBlocks={(from, to) =>
                  reorderBlocks(category.id, from, to)
                }
              />
            ))
          )}

          <button
            type="button"
            className="btn btn-ghost btn-sm block-library-add-category"
            onClick={addCategory}
          >
            New category +
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function CategorySection({
  category,
  categoryIndex,
  categoryCount,
  editingKey,
  onEditingKeyChange,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
  onAddBlock,
  onUpdateBlock,
  onRemoveBlock,
  onReorderBlocks,
}: {
  category: BlockLibraryCategory
  categoryIndex: number
  categoryCount: number
  editingKey: string | null
  onEditingKeyChange: (key: string | null) => void
  onRename: (name: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onAddBlock: () => void
  onUpdateBlock: (blockId: string, next: Omit<SavedBlock, 'id'>) => void
  onRemoveBlock: (blockId: string) => void
  onReorderBlocks: (fromIndex: number, toIndex: number) => void
}) {
  const [name, setName] = useState(category.name)
  const listRef = useRef<HTMLUListElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)
  const dropLineIndexRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    setName(category.name)
  }, [category.name])

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
        <input
          className="block-library-category-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onRename(name.trim() || 'Untitled')}
          aria-label="Category name"
        />
        <div className="block-library-category-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={categoryIndex === 0}
            onClick={onMoveUp}
            aria-label="Move category up"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={categoryIndex >= categoryCount - 1}
            onClick={onMoveDown}
            aria-label="Move category down"
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDelete}
          >
            Delete
          </button>
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
              className={[
                'task-card',
                dragIndex === index ? 'is-dragging' : '',
                showLineBefore ? 'drop-line-before' : '',
                editing ? 'is-editing' : '',
                isTaskEmpty(block) && !editing ? 'task-card-empty' : '',
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
                  onCancel={() => onEditingKeyChange(null)}
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
                      {block.title}
                      <span className="muted task-duration">
                        {' '}
                        · {block.durationMinutes} min
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
                      ✎
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
                      ×
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
        className="btn btn-ghost btn-sm block-library-add-block"
        onClick={onAddBlock}
      >
        New block +
      </button>
    </section>
  )
}
