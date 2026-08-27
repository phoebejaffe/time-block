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
  moveSavedBlock,
  optionalNote,
  touchBlockLibrary,
} from '../lib/tasks'
import { TaskFieldsForm } from './TaskFieldsForm'
import { EditIcon, NoteIcon, TrashIcon } from './icons'
import { FixedMenuPortal } from './FixedMenuPortal'
import type { NoticeOptions } from '../lib/notice'
import { undoNoticeOptions } from '../lib/notice'
import { useFixedMenu } from '../hooks/useFixedMenu'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {
  attachClosestEdge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'

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

type LibraryDropTarget = {
  type: 'block' | 'category'
  categoryId: string
  blockId?: string
  index?: number
  closestEdge?: 'top' | 'bottom'
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
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(
    null,
  )
  const [categoryNameInput, setCategoryNameInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const [highlightBlockId, setHighlightBlockId] = useState<string | null>(null)
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<LibraryDropTarget | null>(null)
  const libraryRef = useRef(library)
  libraryRef.current = library
  const moveBlockRef = useRef<
    (blockId: string, target: LibraryDropTarget) => void
  >(() => {})

  useEffect(() => {
    return monitorForElements({
      onDragStart({ source }) {
        const data = source.data as { type?: string; blockId?: string }
        if (data.type !== 'block' || !data.blockId) return
        setDraggingBlockId(data.blockId)
      },
      onDrag({ location }) {
        const target = location.current.dropTargets[0]
        const data = target?.data as LibraryDropTarget | undefined
        if (!data || (data.type !== 'block' && data.type !== 'category')) {
          setDropTarget(null)
          return
        }
        setDropTarget(data)
      },
      onDrop({ source, location }) {
        const sourceData = source.data as {
          type?: string
          blockId?: string
        }
        const target = location.current.dropTargets[0]
        const targetData = target?.data as LibraryDropTarget | undefined
        if (
          sourceData.type === 'block' &&
          sourceData.blockId &&
          targetData &&
          (targetData.type === 'block' || targetData.type === 'category')
        ) {
          moveBlockRef.current(sourceData.blockId, targetData)
        }
        setDraggingBlockId(null)
        setDropTarget(null)
      },
    })
  }, [])

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

  function closeCategoryNameDialog() {
    setCreatingCategory(false)
    setRenamingCategoryId(null)
    setCategoryNameInput('')
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (creatingCategory || renamingCategoryId) {
        event.preventDefault()
        closeCategoryNameDialog()
        return
      }
      onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [creatingCategory, renamingCategoryId, onClose])

  function commitCategories(categories: BlockLibraryCategory[]) {
    onChange(touchBlockLibrary(categories))
  }

  function moveBlock(blockId: string, target: LibraryDropTarget) {
    const categories = moveSavedBlock(
      libraryRef.current.categories,
      blockId,
      target.categoryId,
      target.blockId,
      target.closestEdge,
    )
    if (categories !== libraryRef.current.categories) commitCategories(categories)
  }
  moveBlockRef.current = moveBlock

  function updateCategory(
    categoryId: string,
    updater: (category: BlockLibraryCategory) => BlockLibraryCategory,
  ) {
    commitCategories(
      library.categories.map((c) => (c.id === categoryId ? updater(c) : c)),
    )
  }

  function addCategory() {
    setRenamingCategoryId(null)
    setCreatingCategory(true)
    setCategoryNameInput('')
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
              note: next.note,
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

  function openRenameCategory(categoryId: string) {
    const category = library.categories.find((c) => c.id === categoryId)
    if (!category) return
    setCreatingCategory(false)
    setRenamingCategoryId(categoryId)
    setCategoryNameInput(category.name)
  }

  function handleSubmitCategoryName(e: React.FormEvent) {
    e.preventDefault()
    const name = categoryNameInput.trim() || 'Untitled'
    if (creatingCategory) {
      const category: BlockLibraryCategory = {
        id: crypto.randomUUID(),
        name,
        blocks: [],
      }
      commitCategories([...library.categories, category])
    } else if (renamingCategoryId) {
      updateCategory(renamingCategoryId, (c) => ({ ...c, name }))
    }
    closeCategoryNameDialog()
  }

  const categoryNameDialog = creatingCategory
    ? { title: 'New category', submitLabel: 'Create' }
    : renamingCategoryId
      ? { title: 'Rename category', submitLabel: 'Save' }
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
                draggingBlockId={draggingBlockId}
                dropTarget={dropTarget}
                onDropTargetChange={setDropTarget}
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

      {categoryNameDialog && (
        <div
          className="modal-backdrop modal-backdrop-nested"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCategoryNameDialog()
          }}
        >
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={categoryNameDialog.title}
          >
            <div className="modal-header">
              <h2>{categoryNameDialog.title}</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={closeCategoryNameDialog}
              >
                ×
              </button>
            </div>
            <form className="modal-form" onSubmit={handleSubmitCategoryName}>
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
                  onClick={closeCategoryNameDialog}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  {categoryNameDialog.submitLabel}
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
  draggingBlockId,
  dropTarget,
  onDropTargetChange,
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
  draggingBlockId: string | null
  dropTarget: LibraryDropTarget | null
  onDropTargetChange: (target: LibraryDropTarget | null) => void
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

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    return dropTargetForElements({
      element: list,
      canDrop: ({ source }) => source.data.type === 'block',
      getData: () => ({ type: 'category', categoryId: category.id }),
    })
  }, [category.id])

  function blockKey(blockId: string) {
    return `${category.id}:${blockId}`
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

      <ul
        className={[
          'task-list',
          'block-library-list',
          dropTarget?.type === 'category' && dropTarget.categoryId === category.id
            ? 'is-drop-target'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        ref={listRef}
      >
        {category.blocks.map((block, index) => (
          <LibraryBlockRow
            key={block.id}
            block={block}
            categoryId={category.id}
            index={index}
            editing={editingKey === blockKey(block.id)}
            onEdit={() => onEditingKeyChange(blockKey(block.id))}
            onUpdate={(next) => onUpdateBlock(block.id, next)}
            onCancel={() => {
              if (!block.title.trim()) onDiscardBlock(block.id)
              else onEditingKeyChange(null)
            }}
            onRemove={() => onRemoveBlock(block.id)}
            dragging={draggingBlockId === block.id}
            dropTarget={dropTarget}
            onDropTargetChange={onDropTargetChange}
            highlight={highlightBlockId === block.id}
          />
        ))}
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

function LibraryBlockRow({
  block,
  categoryId,
  index,
  editing,
  onEdit,
  onUpdate,
  onCancel,
  onRemove,
  dragging,
  dropTarget,
  onDropTargetChange,
  highlight,
}: {
  block: SavedBlock
  categoryId: string
  index: number
  editing: boolean
  onEdit: () => void
  onUpdate: (next: Omit<SavedBlock, 'id'>) => void
  onCancel: () => void
  onRemove: () => void
  dragging: boolean
  dropTarget: LibraryDropTarget | null
  onDropTargetChange: (target: LibraryDropTarget | null) => void
  highlight: boolean
}) {
  const rowRef = useRef<HTMLLIElement>(null)
  const isTarget =
    dropTarget?.type === 'block' && dropTarget.blockId === block.id
  const note = optionalNote(block.note)

  useEffect(() => {
    const row = rowRef.current
    if (!row || editing) return
    return draggable({
      element: row,
      getInitialData: () => ({
        type: 'block',
        blockId: block.id,
        categoryId,
      }),
    })
  }, [block.id, categoryId, editing])

  useEffect(() => {
    const row = rowRef.current
    if (!row || editing) return
    return dropTargetForElements({
      element: row,
      canDrop: ({ source }) => source.data.type === 'block',
      getData: ({ input, element }) =>
        attachClosestEdge(
          {
            type: 'block',
            blockId: block.id,
            categoryId,
            index,
          },
          { input, element, allowedEdges: ['top', 'bottom'] },
        ),
      onDragLeave: () => onDropTargetChange(null),
    })
  }, [block.id, categoryId, editing, index, onDropTargetChange])

  return (
    <li
      ref={rowRef}
      data-block-index={index}
      data-block-id={block.id}
      className={[
        'task-card',
        dragging ? 'is-dragging' : '',
        isTarget && extractClosestEdge(dropTarget) === 'top'
          ? 'drop-line-before'
          : '',
        isTarget && extractClosestEdge(dropTarget) === 'bottom'
          ? 'drop-line-after'
          : '',
        editing ? 'is-editing' : '',
        isTaskEmpty(block) && !editing ? 'task-card-empty' : '',
        highlight ? 'is-just-added' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {editing ? (
        <TaskFieldsForm
          initialTitle={block.title}
          initialDuration={block.durationMinutes}
          initialEmpty={block.empty === true}
          initialNote={block.note ?? ''}
          submitLabel="Save"
          onCancel={onCancel}
          onSubmit={(next) => {
            onUpdate(next)
            onCancel()
          }}
        />
      ) : (
        <>
          <div className="task-card-main">
            <button
              type="button"
              className="block-library-title-button"
              onClick={onEdit}
            >
              <span className="task-title">
                <span className="task-title-text">
                  {block.title.trim() || 'Untitled'}
                </span>
                <span className="muted task-duration">
                  · {formatDurationMinutes(block.durationMinutes)}
                </span>
                {note && (
                  <span className="task-note-icon" title={note} aria-hidden>
                    <NoteIcon />
                  </span>
                )}
              </span>
            </button>
          </div>
          <div className="task-card-icons">
            <button
              type="button"
              className="icon-btn"
              aria-label={`Edit ${block.title}`}
              title="Edit"
              onClick={onEdit}
            >
              <EditIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${block.title}`}
              title="Remove"
              onClick={onRemove}
            >
              <TrashIcon />
            </button>
          </div>
        </>
      )}
    </li>
  )
}
