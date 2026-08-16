import {
  anchorOnDay,
  createBlockGroup,
  createTask,
  type BlockGroup,
  type BlockGroupCheckpoint,
  type CalendarGuest,
  type StackAnchor,
  type Task,
} from './tasks'
import { cloneCalendarGuests } from './savedCalendarUsers'

export type ArchivedPlanTask = {
  title: string
  durationMinutes: number
  empty?: boolean
  delay?: boolean
  disabled?: boolean
}

export type ArchivedPlan = {
  id: string
  tasks: ArchivedPlanTask[]
  anchor: StackAnchor
  archivedAt: string
  name?: string
  color?: string
  checkpoint?: BlockGroupCheckpoint
  calendarGuests?: Record<string, CalendarGuest[]>
}

export type ArchiveFolder = {
  id: string
  name: string
  plans: ArchivedPlan[]
}

export type PlanArchive = {
  folders: ArchiveFolder[]
  updatedAt: string
}

export const UNFILED_FOLDER_ID = 'unfiled'
export const UNFILED_FOLDER_NAME = 'Unfiled'

function newId(): string {
  return crypto.randomUUID()
}

function snapshotTasks(tasks: Task[]): ArchivedPlanTask[] {
  return tasks.map((t) => ({
    title: t.title,
    durationMinutes: t.durationMinutes,
    ...(t.empty || t.delay ? { empty: true } : {}),
    ...(t.delay ? { delay: true } : {}),
    ...(t.disabled ? { disabled: true } : {}),
  }))
}

function cloneCheckpoint(
  checkpoint: BlockGroupCheckpoint,
): BlockGroupCheckpoint {
  return {
    tasks: checkpoint.tasks.map((t) => ({
      title: t.title,
      durationMinutes: t.durationMinutes,
      ...(t.empty || t.delay ? { empty: true } : {}),
      ...(t.delay ? { delay: true } : {}),
      ...(t.disabled ? { disabled: true } : {}),
    })),
    savedAt: checkpoint.savedAt,
    ...(checkpoint.anchor
      ? { anchor: { kind: checkpoint.anchor.kind, at: checkpoint.anchor.at } }
      : {}),
  }
}

export function archivedPlanFromGroup(
  group: BlockGroup,
  archivedAt: string = new Date().toISOString(),
): ArchivedPlan {
  const calendarGuests = cloneCalendarGuests(group.calendarGuests)
  return {
    id: newId(),
    tasks: snapshotTasks(group.tasks),
    anchor: { kind: group.anchor.kind, at: group.anchor.at },
    archivedAt,
    ...(group.name?.trim() ? { name: group.name.trim() } : {}),
    ...(group.color?.trim() ? { color: group.color.trim() } : {}),
    ...(group.checkpoint ? { checkpoint: cloneCheckpoint(group.checkpoint) } : {}),
    ...(calendarGuests ? { calendarGuests } : {}),
  }
}

export function blockGroupFromArchivedPlan(
  archived: ArchivedPlan,
  day: Date = new Date(),
): BlockGroup {
  const group = createBlockGroup({
    tasks: archived.tasks.map((t) =>
      createTask({
        title: t.title,
        durationMinutes: t.durationMinutes,
        ...(t.empty || t.delay ? { empty: true } : {}),
        ...(t.delay ? { delay: true } : {}),
        ...(t.disabled ? { disabled: true } : {}),
      }),
    ),
    anchor: anchorOnDay(archived.anchor, day),
    ...(archived.name ? { name: archived.name } : {}),
    ...(archived.color ? { color: archived.color } : {}),
    ...(archived.calendarGuests
      ? { calendarGuests: archived.calendarGuests }
      : {}),
  })
  if (!archived.checkpoint) return group
  return { ...group, checkpoint: cloneCheckpoint(archived.checkpoint) }
}

function unfiledFolder(plans: ArchivedPlan[] = []): ArchiveFolder {
  return { id: UNFILED_FOLDER_ID, name: UNFILED_FOLDER_NAME, plans }
}

export function defaultPlanArchive(): PlanArchive {
  return {
    folders: [unfiledFolder()],
    updatedAt: new Date().toISOString(),
  }
}

export function touchPlanArchive(folders: ArchiveFolder[]): PlanArchive {
  return {
    folders: ensureUnfiledFolder(folders),
    updatedAt: new Date().toISOString(),
  }
}

export function ensureUnfiledFolder(folders: ArchiveFolder[]): ArchiveFolder[] {
  const rest: ArchiveFolder[] = []
  let unfiledIndex = -1
  let unfiledPlans: ArchivedPlan[] = []
  for (const folder of folders) {
    if (folder.id === UNFILED_FOLDER_ID) {
      unfiledPlans = [...unfiledPlans, ...folder.plans]
      if (unfiledIndex < 0) {
        unfiledIndex = rest.length
        rest.push(unfiledFolder())
      }
      continue
    }
    rest.push(folder)
  }
  const unfiled = unfiledFolder(unfiledPlans)
  if (unfiledIndex < 0) return [unfiled, ...rest]
  rest[unfiledIndex] = unfiled
  return rest
}

function normalizeArchivedTask(raw: unknown): ArchivedPlanTask | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Partial<ArchivedPlanTask>
  if (typeof t.title !== 'string' || typeof t.durationMinutes !== 'number') {
    return null
  }
  const delay = t.delay === true
  return {
    title: t.title,
    durationMinutes: Math.max(1, Math.round(t.durationMinutes) || 1),
    ...(t.empty || delay ? { empty: true } : {}),
    ...(delay ? { delay: true } : {}),
    ...(t.disabled === true ? { disabled: true } : {}),
  }
}

function normalizeCheckpoint(raw: unknown): BlockGroupCheckpoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Partial<BlockGroupCheckpoint>
  if (!Array.isArray(c.tasks) || typeof c.savedAt !== 'string') return undefined
  const tasks = c.tasks
    .map(normalizeArchivedTask)
    .filter((t): t is ArchivedPlanTask => t != null)
  const checkpoint: BlockGroupCheckpoint = { tasks, savedAt: c.savedAt }
  if (
    c.anchor &&
    (c.anchor.kind === 'start' || c.anchor.kind === 'end') &&
    typeof c.anchor.at === 'string'
  ) {
    checkpoint.anchor = { kind: c.anchor.kind, at: c.anchor.at }
  }
  return checkpoint
}

function normalizeArchivedPlan(raw: unknown): ArchivedPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<ArchivedPlan>
  if (typeof p.id !== 'string' || !Array.isArray(p.tasks)) return null
  if (
    !p.anchor ||
    (p.anchor.kind !== 'start' && p.anchor.kind !== 'end') ||
    typeof p.anchor.at !== 'string'
  ) {
    return null
  }
  const tasks = p.tasks
    .map(normalizeArchivedTask)
    .filter((t): t is ArchivedPlanTask => t != null)
  return {
    id: p.id,
    tasks,
    anchor: { kind: p.anchor.kind, at: p.anchor.at },
    archivedAt:
      typeof p.archivedAt === 'string' ? p.archivedAt : new Date().toISOString(),
    ...(typeof p.name === 'string' && p.name.trim()
      ? { name: p.name.trim() }
      : {}),
    ...(typeof p.color === 'string' && p.color.trim()
      ? { color: p.color.trim() }
      : {}),
    ...(normalizeCheckpoint(p.checkpoint)
      ? { checkpoint: normalizeCheckpoint(p.checkpoint) }
      : {}),
    ...(cloneCalendarGuests(p.calendarGuests)
      ? { calendarGuests: cloneCalendarGuests(p.calendarGuests) }
      : {}),
  }
}

function normalizeFolder(raw: unknown): ArchiveFolder | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Partial<ArchiveFolder>
  if (typeof f.id !== 'string' || typeof f.name !== 'string') return null
  if (!Array.isArray(f.plans)) return null
  const plans = f.plans
    .map(normalizeArchivedPlan)
    .filter((p): p is ArchivedPlan => p != null)
  return {
    id: f.id,
    name: f.id === UNFILED_FOLDER_ID ? UNFILED_FOLDER_NAME : f.name.trim() || 'Untitled',
    plans,
  }
}

export function normalizePlanArchive(raw: unknown): PlanArchive {
  if (!raw || typeof raw !== 'object') return defaultPlanArchive()
  const data = raw as Partial<PlanArchive>
  if (!Array.isArray(data.folders)) return defaultPlanArchive()
  const folders = data.folders
    .map(normalizeFolder)
    .filter((f): f is ArchiveFolder => f != null)
  return {
    folders: ensureUnfiledFolder(folders),
    updatedAt:
      typeof data.updatedAt === 'string'
        ? data.updatedAt
        : new Date().toISOString(),
  }
}

export function archivedPlanCount(archive: PlanArchive): number {
  return archive.folders.reduce((sum, folder) => sum + folder.plans.length, 0)
}

export function findArchivedPlan(
  archive: PlanArchive,
  planId: string,
): { folder: ArchiveFolder; plan: ArchivedPlan; index: number } | null {
  for (const folder of archive.folders) {
    const index = folder.plans.findIndex((p) => p.id === planId)
    if (index >= 0) {
      return { folder, plan: folder.plans[index]!, index }
    }
  }
  return null
}

function mapFolders(
  archive: PlanArchive,
  updater: (folders: ArchiveFolder[]) => ArchiveFolder[],
): PlanArchive {
  return touchPlanArchive(updater(archive.folders))
}

export function addArchivedPlan(
  archive: PlanArchive,
  plan: ArchivedPlan,
  folderId: string = UNFILED_FOLDER_ID,
): PlanArchive {
  const folders = ensureUnfiledFolder(archive.folders)
  const targetId = folders.some((f) => f.id === folderId)
    ? folderId
    : UNFILED_FOLDER_ID
  return touchPlanArchive(
    folders.map((folder) =>
      folder.id === targetId
        ? { ...folder, plans: [...folder.plans, plan] }
        : folder,
    ),
  )
}

export function removeArchivedPlan(
  archive: PlanArchive,
  planId: string,
): { archive: PlanArchive; removed: ArchivedPlan | null } {
  const found = findArchivedPlan(archive, planId)
  if (!found) return { archive, removed: null }
  return {
    archive: mapFolders(archive, (folders) =>
      folders.map((folder) =>
        folder.id === found.folder.id
          ? {
              ...folder,
              plans: folder.plans.filter((p) => p.id !== planId),
            }
          : folder,
      ),
    ),
    removed: found.plan,
  }
}

export function renameArchivedPlan(
  archive: PlanArchive,
  planId: string,
  name: string,
): PlanArchive {
  const trimmed = name.trim()
  return mapFolders(archive, (folders) =>
    folders.map((folder) => ({
      ...folder,
      plans: folder.plans.map((plan) => {
        if (plan.id !== planId) return plan
        if (!trimmed) {
          const { name: _n, ...rest } = plan
          return rest
        }
        return { ...plan, name: trimmed }
      }),
    })),
  )
}

export function setArchivedPlanColor(
  archive: PlanArchive,
  planId: string,
  color: string | undefined,
): PlanArchive {
  const trimmed = color?.trim()
  return mapFolders(archive, (folders) =>
    folders.map((folder) => ({
      ...folder,
      plans: folder.plans.map((plan) => {
        if (plan.id !== planId) return plan
        if (!trimmed) {
          const { color: _c, ...rest } = plan
          return rest
        }
        return { ...plan, color: trimmed }
      }),
    })),
  )
}

export function duplicateArchivedPlan(
  archive: PlanArchive,
  planId: string,
): PlanArchive {
  const found = findArchivedPlan(archive, planId)
  if (!found) return archive
  const copy: ArchivedPlan = {
    ...found.plan,
    id: newId(),
    archivedAt: new Date().toISOString(),
    ...(found.plan.checkpoint
      ? { checkpoint: cloneCheckpoint(found.plan.checkpoint) }
      : {}),
  }
  return mapFolders(archive, (folders) =>
    folders.map((folder) => {
      if (folder.id !== found.folder.id) return folder
      const plans = [...folder.plans]
      plans.splice(found.index + 1, 0, copy)
      return { ...folder, plans }
    }),
  )
}

export function moveArchivedPlanToFolder(
  archive: PlanArchive,
  planId: string,
  folderId: string,
): PlanArchive {
  const found = findArchivedPlan(archive, planId)
  if (!found) return archive
  const folders = ensureUnfiledFolder(archive.folders)
  const targetId = folders.some((f) => f.id === folderId)
    ? folderId
    : UNFILED_FOLDER_ID
  if (found.folder.id === targetId) return archive
  return touchPlanArchive(
    folders.map((folder) => {
      if (folder.id === found.folder.id) {
        return {
          ...folder,
          plans: folder.plans.filter((p) => p.id !== planId),
        }
      }
      if (folder.id === targetId) {
        return { ...folder, plans: [...folder.plans, found.plan] }
      }
      return folder
    }),
  )
}

export function reorderArchivedPlans(
  archive: PlanArchive,
  folderId: string,
  fromIndex: number,
  toIndex: number,
): PlanArchive {
  return mapFolders(archive, (folders) =>
    folders.map((folder) => {
      if (folder.id !== folderId) return folder
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= folder.plans.length ||
        toIndex >= folder.plans.length ||
        fromIndex === toIndex
      ) {
        return folder
      }
      const plans = [...folder.plans]
      const [moved] = plans.splice(fromIndex, 1)
      if (!moved) return folder
      plans.splice(toIndex, 0, moved)
      return { ...folder, plans }
    }),
  )
}

export function addArchiveFolder(
  archive: PlanArchive,
  name = 'New folder',
): PlanArchive {
  const folder: ArchiveFolder = {
    id: newId(),
    name: name.trim() || 'New folder',
    plans: [],
  }
  return mapFolders(archive, (folders) => [...folders, folder])
}

export function renameArchiveFolder(
  archive: PlanArchive,
  folderId: string,
  name: string,
): PlanArchive {
  if (folderId === UNFILED_FOLDER_ID) return archive
  const trimmed = name.trim() || 'Untitled'
  return mapFolders(archive, (folders) =>
    folders.map((folder) =>
      folder.id === folderId ? { ...folder, name: trimmed } : folder,
    ),
  )
}

export function removeArchiveFolder(
  archive: PlanArchive,
  folderId: string,
  destinationFolderId: string = UNFILED_FOLDER_ID,
): PlanArchive {
  if (folderId === UNFILED_FOLDER_ID) return archive
  if (destinationFolderId === folderId) return archive
  const folders = ensureUnfiledFolder(archive.folders)
  const removed = folders.find((f) => f.id === folderId)
  if (!removed) return archive
  const destExists = folders.some((f) => f.id === destinationFolderId)
  const destId = destExists ? destinationFolderId : UNFILED_FOLDER_ID
  return touchPlanArchive(
    folders
      .filter((f) => f.id !== folderId)
      .map((folder) =>
        folder.id === destId
          ? { ...folder, plans: [...folder.plans, ...removed.plans] }
          : folder,
      ),
  )
}

export function moveArchiveFolder(
  archive: PlanArchive,
  folderId: string,
  direction: -1 | 1,
): PlanArchive {
  const folders = ensureUnfiledFolder(archive.folders)
  const index = folders.findIndex((f) => f.id === folderId)
  if (index < 0) return archive
  const target = index + direction
  if (target < 0 || target >= folders.length) return archive
  const next = [...folders]
  const [moved] = next.splice(index, 1)
  if (!moved) return archive
  next.splice(target, 0, moved)
  return touchPlanArchive(next)
}

export function archivedPlanMatchesQuery(
  plan: ArchivedPlan,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const name = (plan.name ?? '').toLowerCase()
  if (name.includes(q)) return true
  return plan.tasks.some((t) => t.title.toLowerCase().includes(q))
}

/** Compact local date for archive rows: "Aug 14" or "Aug 14, 2025". */
export function formatArchivedDate(
  isoOrDate: string | Date,
  now: Date = new Date(),
): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(d.getTime())) return ''
  const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(d)
  if (d.getFullYear() === now.getFullYear()) {
    return `${month} ${d.getDate()}`
  }
  return `${month} ${d.getDate()}, ${d.getFullYear()}`
}
