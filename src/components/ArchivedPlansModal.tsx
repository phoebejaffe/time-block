import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addArchiveFolder,
  addArchivedPlan,
  archivedPlanCount,
  archivedPlanMatchesQuery,
  formatArchivedDate,
  moveArchivedPlanToFolder,
  moveArchiveFolder,
  removeArchiveFolder,
  removeArchivedPlan,
  renameArchiveFolder,
  renameArchivedPlan,
  reorderArchivedPlans,
  setArchivedPlanColor,
  UNFILED_FOLDER_ID,
  type ArchivedPlan,
  type ArchiveFolder,
  type PlanArchive,
  type PlanArchiveChangeOptions,
} from '../lib/planArchive'
import {
  DEFAULT_GROUP_COLOR,
  formatDurationMinutes,
  groupSidebarAccentColor,
  isTaskDisabled,
  isTaskEmpty,
  stackDurationMinutes,
} from '../lib/tasks'
import type { NoticeOptions } from '../lib/notice'
import { undoNoticeOptions } from '../lib/notice'
import { useFixedMenu } from '../hooks/useFixedMenu'
import { FixedMenuPortal } from './FixedMenuPortal'
import {
  attachReorderDragListeners,
  consumeReorderClickSuppression,
} from '../lib/reorderDrag'

type ArchivedPlansModalProps = {
  archive: PlanArchive
  loading?: boolean
  onChange: (
    archive: PlanArchive,
    options?: PlanArchiveChangeOptions,
  ) => void
  onAddToHome: (plan: ArchivedPlan) => void
  onClose: () => void
  onShowNotice?: (text: string, options?: NoticeOptions) => void
  onClearNotice?: () => void
  majorUndoSeconds?: number
}

export function ArchivedPlansModal({
  archive,
  loading = false,
  onChange,
  onAddToHome,
  onClose,
  onShowNotice,
  onClearNotice,
  majorUndoSeconds = 10,
}: ArchivedPlansModalProps) {
  const [query, setQuery] = useState('')
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null)
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null)
  const [movingPlanId, setMovingPlanId] = useState<string | null>(null)
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [nameInput, setNameInput] = useState('')

  function closeNested() {
    setRenamingFolderId(null)
    setRenamingPlanId(null)
    setMovingPlanId(null)
    setDeletingFolderId(null)
    setCreatingFolder(false)
    setNameInput('')
  }

  const nestedOpen =
    Boolean(renamingFolderId) ||
    Boolean(renamingPlanId) ||
    Boolean(movingPlanId) ||
    Boolean(deletingFolderId) ||
    creatingFolder

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (nestedOpen) {
        closeNested()
        return
      }
      onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, nestedOpen])

  const searching = query.trim().length > 0
  const total = archivedPlanCount(archive)
  const searchHits = useMemo(() => {
    if (!searching) return []
    const hits: { folder: ArchiveFolder; plan: ArchivedPlan }[] = []
    for (const folder of archive.folders) {
      for (const plan of folder.plans) {
        if (archivedPlanMatchesQuery(plan, query)) hits.push({ folder, plan })
      }
    }
    return hits
  }, [archive, query, searching])

  const renamingFolder = renamingFolderId
    ? archive.folders.find((f) => f.id === renamingFolderId)
    : null
  const renamingPlan = renamingPlanId
    ? archive.folders.flatMap((f) => f.plans).find((p) => p.id === renamingPlanId)
    : null
  const movingPlan = movingPlanId
    ? archive.folders.flatMap((f) => f.plans).find((p) => p.id === movingPlanId)
    : null
  const movingFromFolder = movingPlanId
    ? archive.folders.find((f) => f.plans.some((p) => p.id === movingPlanId))
    : null
  const deletingFolder = deletingFolderId
    ? archive.folders.find((f) => f.id === deletingFolderId)
    : null

  function toggleExpanded(planId: string) {
    setExpandedPlanId((current) => (current === planId ? null : planId))
  }

  function toggleFolderCollapsed(folderId: string) {
    const collapsing = !collapsedFolderIds.has(folderId)
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
    if (!collapsing) return
    const folder = archive.folders.find((f) => f.id === folderId)
    if (folder?.plans.some((p) => p.id === expandedPlanId)) {
      setExpandedPlanId(null)
    }
  }

  function handleRenameFolder(e: React.FormEvent) {
    e.preventDefault()
    if (!renamingFolderId) return
    onChange(renameArchiveFolder(archive, renamingFolderId, nameInput))
    closeNested()
  }

  function handleRenamePlan(e: React.FormEvent) {
    e.preventDefault()
    if (!renamingPlanId) return
    onChange(renameArchivedPlan(archive, renamingPlanId, nameInput))
    closeNested()
  }

  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault()
    onChange(addArchiveFolder(archive, nameInput))
    closeNested()
  }

  function handleDeleteFolder(folderId: string) {
    const folder = archive.folders.find((f) => f.id === folderId)
    if (!folder || folder.id === UNFILED_FOLDER_ID) return
    if (folder.plans.length === 0) {
      const previous = archive
      const label = folder.name.trim() || 'Untitled'
      onChange(removeArchiveFolder(archive, folderId), {
        allowDestructive: true,
      })
      onShowNotice?.(`“${label}” folder deleted`, {
        ...undoNoticeOptions(majorUndoSeconds, () => {
          onChange(previous)
          onClearNotice?.()
        }),
      })
      return
    }
    setDeletingFolderId(folderId)
  }

  function handleDeletePlan(plan: ArchivedPlan, folder: ArchiveFolder) {
    const label = plan.name?.trim() || 'Untitled plan'
    const { archive: next, removed } = removeArchivedPlan(archive, plan.id)
    if (!removed) return
    onChange(next, { allowDestructive: true })
    if (expandedPlanId === plan.id) setExpandedPlanId(null)
    onShowNotice?.(`“${label}” deleted from archive`, {
      ...undoNoticeOptions(majorUndoSeconds, () => {
        onChange(addArchivedPlan(next, removed, folder.id))
        onClearNotice?.()
      }),
    })
  }

  const rowActions = {
    expandedPlanId,
    onToggleExpanded: toggleExpanded,
    onAddToHome,
    onRename: (plan: ArchivedPlan) => {
      setRenamingPlanId(plan.id)
      setNameInput(plan.name ?? '')
    },
    onSetColor: (plan: ArchivedPlan, color: string | undefined) => {
      onChange(setArchivedPlanColor(archive, plan.id, color))
    },
    onMove: (plan: ArchivedPlan) => setMovingPlanId(plan.id),
    onDelete: handleDeletePlan,
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
        className="modal-dialog modal-dialog-wide block-library-dialog archived-plans-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Archived plans"
      >
        <div className="modal-header">
          <h2>Archived plans</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="block-library-body archived-plans-body">
          <label className="archived-plans-search">
            <span className="sr-only">Search archived plans</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plans and blocks"
            />
          </label>

          {loading ? (
            <p className="muted block-library-empty archived-plans-loading">
              <span className="spinner spinner-inline" aria-hidden />
              Loading archived plans…
            </p>
          ) : total === 0 && !searching ? (
            <p className="muted block-library-empty">
              Archive a plan from its ··· menu.
            </p>
          ) : searching ? (
            searchHits.length === 0 ? (
              <p className="muted block-library-empty">No matching plans.</p>
            ) : (
              <ul className="task-list block-library-list archived-plan-list">
                {searchHits.map(({ folder, plan }) => (
                  <ArchivedPlanRow
                    key={plan.id}
                    plan={plan}
                    folderLabel={folder.name}
                    expanded={expandedPlanId === plan.id}
                    onToggleExpanded={() => toggleExpanded(plan.id)}
                    onAddToHome={() => onAddToHome(plan)}
                    onRename={() => rowActions.onRename(plan)}
                    onSetColor={(color) => rowActions.onSetColor(plan, color)}
                    onMove={() => rowActions.onMove(plan)}
                    onDelete={() => handleDeletePlan(plan, folder)}
                  />
                ))}
              </ul>
            )
          ) : (
            archive.folders.map((folder, folderIndex) => (
              <FolderSection
                key={folder.id}
                folder={folder}
                canMoveUp={folderIndex > 0}
                canMoveDown={folderIndex < archive.folders.length - 1}
                expandedPlanId={expandedPlanId}
                collapsed={collapsedFolderIds.has(folder.id)}
                onToggleCollapsed={() => toggleFolderCollapsed(folder.id)}
                onOpenRename={() => {
                  setRenamingFolderId(folder.id)
                  setNameInput(folder.name)
                }}
                onMoveUp={() =>
                  onChange(moveArchiveFolder(archive, folder.id, -1))
                }
                onMoveDown={() =>
                  onChange(moveArchiveFolder(archive, folder.id, 1))
                }
                onDelete={() => handleDeleteFolder(folder.id)}
                onToggleExpanded={toggleExpanded}
                onAddToHome={onAddToHome}
                onRenamePlan={rowActions.onRename}
                onSetColor={(plan, color) => rowActions.onSetColor(plan, color)}
                onMovePlan={rowActions.onMove}
                onDeletePlan={(plan) => handleDeletePlan(plan, folder)}
                onReorder={(from, to) =>
                  onChange(reorderArchivedPlans(archive, folder.id, from, to))
                }
              />
            ))
          )}

          {!searching && !loading && (
            <button
              type="button"
              className="task-new-trigger block-library-add-category"
              onClick={() => {
                setCreatingFolder(true)
                setNameInput('')
              }}
            >
              New folder +
            </button>
          )}
        </div>
      </div>

      {renamingFolder && (
        <NestedNameDialog
          title="Rename folder"
          value={nameInput}
          onChange={setNameInput}
          onCancel={closeNested}
          onSubmit={handleRenameFolder}
        />
      )}
      {renamingPlan && (
        <NestedNameDialog
          title="Rename plan"
          value={nameInput}
          onChange={setNameInput}
          placeholder="Morning"
          onCancel={closeNested}
          onSubmit={handleRenamePlan}
        />
      )}
      {creatingFolder && (
        <NestedNameDialog
          title="New folder"
          value={nameInput}
          onChange={setNameInput}
          placeholder="Work"
          submitLabel="Create"
          onCancel={closeNested}
          onSubmit={handleCreateFolder}
        />
      )}
      {movingPlan && movingFromFolder && (
        <FolderPickDialog
          title="Move to folder"
          folders={archive.folders}
          currentFolderId={movingFromFolder.id}
          onPick={(folderId) => {
            onChange(
              moveArchivedPlanToFolder(archive, movingPlan.id, folderId),
            )
            closeNested()
          }}
          onCancel={closeNested}
        />
      )}
      {deletingFolder && (
        <FolderPickDialog
          title="Delete folder"
          hint={`Move ${deletingFolder.plans.length === 1 ? '1 plan' : `${deletingFolder.plans.length} plans`} from “${deletingFolder.name.trim() || 'Untitled'}” to:`}
          folders={archive.folders.filter((f) => f.id !== deletingFolder.id)}
          onPick={(folderId) => {
            const previous = archive
            const label = deletingFolder.name.trim() || 'Untitled'
            onChange(
              removeArchiveFolder(archive, deletingFolder.id, folderId),
              { allowDestructive: true },
            )
            closeNested()
            onShowNotice?.(`“${label}” folder deleted`, {
              ...undoNoticeOptions(majorUndoSeconds, () => {
                onChange(previous)
                onClearNotice?.()
              }),
            })
          }}
          onCancel={closeNested}
        />
      )}
    </div>
  )
}

function NestedNameDialog({
  title,
  value,
  placeholder,
  submitLabel = 'Save',
  onChange,
  onCancel,
  onSubmit,
}: {
  title: string
  value: string
  placeholder?: string
  submitLabel?: string
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <div
      className="modal-backdrop modal-backdrop-nested"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        <form className="modal-body modal-form" onSubmit={onSubmit}>
          <label>
            <span>Name</span>
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              autoFocus
            />
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FolderPickDialog({
  title,
  hint,
  folders,
  currentFolderId,
  onPick,
  onCancel,
}: {
  title: string
  hint?: string
  folders: ArchiveFolder[]
  currentFolderId?: string
  onPick: (folderId: string) => void
  onCancel: () => void
}) {
  return (
    <div
      className="modal-backdrop modal-backdrop-nested"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        <div className="modal-body archived-move-body">
          {hint && <p className="muted archived-move-hint">{hint}</p>}
          <ul className="archived-move-list" role="listbox">
            {folders.map((folder) => {
              const current = folder.id === currentFolderId
              return (
                <li key={folder.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={current}
                    className={
                      current
                        ? 'archived-move-option is-current'
                        : 'archived-move-option'
                    }
                    disabled={current}
                    onClick={() => onPick(folder.id)}
                  >
                    <span className="archived-move-option-name">
                      {folder.name}
                    </span>
                    {current && (
                      <span className="archived-move-option-current">
                        Current
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FolderSection({
  folder,
  canMoveUp,
  canMoveDown,
  expandedPlanId,
  collapsed,
  onToggleCollapsed,
  onOpenRename,
  onMoveUp,
  onMoveDown,
  onDelete,
  onToggleExpanded,
  onAddToHome,
  onRenamePlan,
  onSetColor,
  onMovePlan,
  onDeletePlan,
  onReorder,
}: {
  folder: ArchiveFolder
  canMoveUp: boolean
  canMoveDown: boolean
  expandedPlanId: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenRename: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onToggleExpanded: (planId: string) => void
  onAddToHome: (plan: ArchivedPlan) => void
  onRenamePlan: (plan: ArchivedPlan) => void
  onSetColor: (plan: ArchivedPlan, color: string | undefined) => void
  onMovePlan: (plan: ArchivedPlan) => void
  onDeletePlan: (plan: ArchivedPlan) => void
  onReorder: (fromIndex: number, toIndex: number) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const suppressClickRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = useFixedMenu({
    open: menuOpen,
    align: 'end',
    onClose: () => setMenuOpen(false),
  })
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)
  const dropLineIndexRef = useRef<number | null>(null)
  const isUnfiled = folder.id === UNFILED_FOLDER_ID
  const showFolderMenu = !isUnfiled || canMoveUp || canMoveDown

  useEffect(() => {
    dropLineIndexRef.current = dropLineIndex
  }, [dropLineIndex])

  function lineIndexFromY(clientY: number): number {
    const list = listRef.current
    if (!list) return 0
    const cards = list.querySelectorAll<HTMLElement>('[data-plan-index]')
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i]!.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return i
    }
    return cards.length
  }

  function beginPlanDrag(e: React.PointerEvent<HTMLElement>, index: number) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    suppressClickRef.current = false

    attachReorderDragListeners({
      handle: e.currentTarget,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      shouldAbortMove: (dx, dy) => Math.abs(dy) < Math.abs(dx),
      onActivate: () => {
        dropLineIndexRef.current = index
        setDragIndex(index)
        setDropLineIndex(index)
        document.body.classList.add('is-task-reordering')
        e.currentTarget.classList.add('is-dragging-original')
      },
      onMove: (ev) => {
        const nextLine = lineIndexFromY(ev.clientY)
        if (dropLineIndexRef.current !== nextLine) {
          dropLineIndexRef.current = nextLine
          setDropLineIndex(nextLine)
        }
      },
      onEnd: (_ev, didActivate) => {
        const insertAt = dropLineIndexRef.current
        const from = index
        document.body.classList.remove('is-task-reordering')
        setDragIndex(null)
        setDropLineIndex(null)
        dropLineIndexRef.current = null
        if (!didActivate || insertAt == null) return
        let toIndex = insertAt
        if (from < insertAt) toIndex -= 1
        if (toIndex === from) return
        onReorder(from, toIndex)
      },
      onSuppressClick: () => {
        suppressClickRef.current = true
      },
    })
  }

  const planCount = folder.plans.length
  const folderName = folder.name.trim() || 'Untitled'

  return (
    <section
      className={[
        'block-library-category',
        'archived-folder',
        collapsed ? 'is-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="block-library-category-header">
        <button
          type="button"
          className="archived-folder-toggle"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <span className="archived-plan-chevron" aria-hidden>
            <ChevronIcon />
          </span>
          <span className="block-library-category-title">{folderName}</span>
          {collapsed && planCount > 0 && (
            <span className="muted archived-folder-count">
              {planCount} {planCount === 1 ? 'plan' : 'plans'}
            </span>
          )}
        </button>
        {showFolderMenu && (
          <div className="task-new-menu block-library-category-menu" ref={menuRef}>
            <button
              type="button"
              ref={menu.triggerRef}
              className="btn btn-text btn-icon task-new-menu-btn"
              aria-label="Folder options"
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
                {!isUnfiled && (
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
                )}
                {(canMoveUp || canMoveDown) && (
                  <>
                    {!isUnfiled && (
                      <div className="calendar-menu-sep" role="separator" />
                    )}
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
                {!isUnfiled && (
                  <>
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
                      Delete folder
                    </button>
                  </>
                )}
            </FixedMenuPortal>
          </div>
        )}
      </div>

      {collapsed ? null : folder.plans.length === 0 ? (
        <p className="muted archived-folder-empty">No plans in this folder.</p>
      ) : (
        <ul className="task-list block-library-list archived-plan-list" ref={listRef}>
          {folder.plans.map((plan, index) => (
            <ArchivedPlanRow
              key={plan.id}
              plan={plan}
              index={index}
              dragIndex={dragIndex}
              dropLineIndex={dropLineIndex}
              expanded={expandedPlanId === plan.id}
              onPointerDown={(e) => beginPlanDrag(e, index)}
              onToggleExpanded={() => {
                if (consumeReorderClickSuppression(suppressClickRef)) return
                onToggleExpanded(plan.id)
              }}
              onAddToHome={() => onAddToHome(plan)}
              onRename={() => onRenamePlan(plan)}
              onSetColor={(color) => onSetColor(plan, color)}
              onMove={() => onMovePlan(plan)}
              onDelete={() => onDeletePlan(plan)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ArchivedPlanRow({
  plan,
  folderLabel,
  index,
  dragIndex,
  dropLineIndex,
  expanded,
  onPointerDown,
  onToggleExpanded,
  onAddToHome,
  onRename,
  onSetColor,
  onMove,
  onDelete,
}: {
  plan: ArchivedPlan
  folderLabel?: string
  index?: number
  dragIndex?: number | null
  dropLineIndex?: number | null
  expanded: boolean
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  onToggleExpanded: () => void
  onAddToHome: () => void
  onRename: () => void
  onSetColor: (color: string | undefined) => void
  onMove: () => void
  onDelete: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = useFixedMenu({
    open: menuOpen,
    align: 'end',
    onClose: () => setMenuOpen(false),
  })
  const accent = groupSidebarAccentColor(plan.color)
  const blockCount = plan.tasks.length
  const duration = formatDurationMinutes(stackDurationMinutes(plan.tasks))
  const archivedOn = formatArchivedDate(plan.archivedAt)
  const colorPickerValue =
    plan.color && /^#[0-9a-fA-F]{6}$/.test(plan.color)
      ? plan.color
      : DEFAULT_GROUP_COLOR
  const showLineBefore =
    dropLineIndex === index &&
    dragIndex != null &&
    dropLineIndex !== dragIndex &&
    dropLineIndex !== dragIndex + 1

  return (
    <li
      data-plan-index={index}
      className={[
        'archived-plan-row',
        expanded ? 'is-expanded' : '',
        dragIndex != null && dragIndex === index ? 'is-dragging is-dragging-original' : '',
        showLineBefore ? 'drop-line-before' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--group-accent' as string]: accent }}
    >
      <div className="archived-plan-head">
        <button
          type="button"
          className={[
            'archived-plan-main',
            onPointerDown ? 'archived-plan-main-draggable' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-expanded={expanded}
          onPointerDown={onPointerDown}
          onClick={onToggleExpanded}
        >
          <span className="archived-plan-copy">
            <span className="archived-plan-name">
              {plan.name?.trim() || 'Untitled plan'}
            </span>
            <span className="muted archived-plan-meta">
              {folderLabel ? `${folderLabel} · ` : ''}
              {blockCount} {blockCount === 1 ? 'block' : 'blocks'}
              {blockCount > 0 ? ` · ${duration}` : ''}
              {archivedOn ? ` · ${archivedOn}` : ''}
            </span>
          </span>
        </button>
        <div className="task-new-menu archived-plan-menu" ref={menuRef}>
          <button
            ref={menu.triggerRef}
            type="button"
            className="btn btn-text btn-icon task-new-menu-btn"
            aria-label="Plan options"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((open) => !open)
            }}
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
                    onAddToHome()
                  }}
                >
                  Duplicate plan
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="calendar-menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    onRename()
                  }}
                >
                  Rename
                </button>
                <label className="calendar-menu-item group-color-menu-item">
                  <span>Change color</span>
                  <input
                    type="color"
                    value={colorPickerValue}
                    aria-label="Plan color"
                    onChange={(e) => {
                      const next = e.target.value
                      onSetColor(next === DEFAULT_GROUP_COLOR ? undefined : next)
                    }}
                  />
                </label>
                <button
                  type="button"
                  role="menuitem"
                  className="calendar-menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    onMove()
                  }}
                >
                  Move to folder
                </button>
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
                  Delete from archive
                </button>
          </FixedMenuPortal>
        </div>
      </div>
      {expanded && (
        <div className="archived-plan-blocks">
          {plan.tasks.length === 0 ? (
            <p className="muted archived-plan-blocks-empty">No blocks</p>
          ) : (
            <ul className="task-list">
              {plan.tasks.map((task, taskIndex) => (
                <li
                  key={taskIndex}
                  className={[
                    'task-card',
                    isTaskEmpty(task) ? 'task-card-empty' : '',
                    isTaskDisabled(task) ? 'task-card-disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="task-card-main">
                    <span className="task-title">
                      <span className="task-title-text">
                        {task.title.trim() || 'Untitled'}
                      </span>
                      <span className="muted task-duration">
                        · {formatDurationMinutes(task.durationMinutes)}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

function ChevronIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 2.2 8.2 6 4 9.8" />
    </svg>
  )
}
