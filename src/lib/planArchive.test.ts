import { describe, expect, it } from 'vitest'
import {
  addArchiveFolder,
  addArchivedPlan,
  archivedPlanFromGroup,
  archivedPlanMatchesQuery,
  blockGroupFromArchivedPlan,
  defaultPlanArchive,
  duplicateArchivedPlan,
  formatArchivedDate,
  moveArchivedPlanToFolder,
  moveArchiveFolder,
  normalizePlanArchive,
  planArchiveShrinks,
  removeArchiveFolder,
  removeArchivedPlan,
  renameArchiveFolder,
  renameArchivedPlan,
  setArchivedPlanColor,
  UNFILED_FOLDER_ID,
  UNFILED_FOLDER_NAME,
} from './planArchive'
import { createBlockGroup, createCheckpoint, createTask } from './tasks'

describe('plan archive', () => {
  const group = createBlockGroup({
    name: 'Morning',
    color: '#112233',
    tasks: [
      createTask({ title: 'Wake', durationMinutes: 10 }),
      createTask({ title: 'Gap', durationMinutes: 5, empty: true }),
    ],
    anchor: { kind: 'start', at: '2026-07-18T16:00:00.000Z' },
  })

  it('defaults to an Unfiled folder', () => {
    const archive = defaultPlanArchive()
    expect(archive.folders).toHaveLength(1)
    expect(archive.folders[0]!.id).toBe(UNFILED_FOLDER_ID)
    expect(archive.folders[0]!.name).toBe(UNFILED_FOLDER_NAME)
    expect(archive.folders[0]!.plans).toEqual([])
  })

  it('snapshots a group without live ids or done flags', () => {
    const withDone = {
      ...group,
      tasks: [{ ...group.tasks[0]!, done: true }, group.tasks[1]!],
      checkpoint: createCheckpoint(group.tasks, group.anchor),
    }
    const archived = archivedPlanFromGroup(withDone)
    expect(archived.name).toBe('Morning')
    expect(archived.tasks[0]).not.toHaveProperty('id')
    expect(archived.tasks[0]).not.toHaveProperty('done')
    expect(archived.checkpoint?.tasks).toHaveLength(2)
  })

  it('copies block notes through archive and home stamp', () => {
    const withNotes = {
      ...group,
      tasks: [
        createTask({
          title: 'Wake',
          durationMinutes: 10,
          note: '  open blinds  ',
        }),
        group.tasks[1]!,
      ],
    }
    const archived = archivedPlanFromGroup(withNotes)
    expect(archived.tasks[0]!.note).toBe('open blinds')
    expect(archived.tasks[1]!).not.toHaveProperty('note')
    const restored = blockGroupFromArchivedPlan(archived)
    expect(restored.tasks[0]!.note).toBe('open blinds')
    expect(restored.tasks[1]!).not.toHaveProperty('note')
  })

  it('stamps a fresh home group remapped onto today', () => {
    const archived = archivedPlanFromGroup(group)
    const today = new Date(2026, 7, 14, 12, 0, 0)
    const restored = blockGroupFromArchivedPlan(archived, today)
    expect(restored.id).not.toBe(group.id)
    expect(restored.tasks[0]!.id).not.toBe(group.tasks[0]!.id)
    expect(restored.tasks[0]!.title).toBe('Wake')
    expect(restored.name).toBe('Morning')
    const restoredDay = new Date(restored.anchor.at)
    expect(restoredDay.getFullYear()).toBe(2026)
    expect(restoredDay.getMonth()).toBe(7)
    expect(restoredDay.getDate()).toBe(14)
  })

  it('copies calendar guests through archive and home stamp', () => {
    const withGuests = {
      ...group,
      calendarGuests: {
        'cal-1': [{ email: 'ada@example.com', name: 'Ada' }],
      },
    }
    const archived = archivedPlanFromGroup(withGuests)
    expect(archived.calendarGuests).toEqual({
      'cal-1': [{ email: 'ada@example.com', name: 'Ada' }],
    })
    const restored = blockGroupFromArchivedPlan(archived)
    expect(restored.calendarGuests).toEqual({
      'cal-1': [{ email: 'ada@example.com', name: 'Ada' }],
    })
  })

  it('adds to Unfiled and can move into a named folder', () => {
    const archived = archivedPlanFromGroup(group)
    let archive = addArchivedPlan(defaultPlanArchive(), archived)
    expect(archive.folders[0]!.plans).toHaveLength(1)
    archive = addArchiveFolder(archive, 'Work')
    expect(archive.folders[0]!.plans[0]!.id).toBe(archived.id)
    const workId = archive.folders[1]!.id
    archive = moveArchivedPlanToFolder(archive, archived.id, workId)
    expect(archive.folders[0]!.plans).toHaveLength(0)
    expect(archive.folders[1]!.plans[0]!.id).toBe(archived.id)
  })

  it('deleting a folder sends plans back to Unfiled by default', () => {
    const archived = archivedPlanFromGroup(group)
    let archive = addArchiveFolder(defaultPlanArchive(), 'Work')
    const workId = archive.folders[1]!.id
    archive = addArchivedPlan(archive, archived, workId)
    archive = removeArchiveFolder(archive, workId)
    expect(archive.folders).toHaveLength(1)
    expect(archive.folders[0]!.id).toBe(UNFILED_FOLDER_ID)
    expect(archive.folders[0]!.plans[0]!.id).toBe(archived.id)
  })

  it('deleting a folder can move plans into another named folder', () => {
    const archived = archivedPlanFromGroup(group)
    let archive = addArchiveFolder(defaultPlanArchive(), 'Work')
    archive = addArchiveFolder(archive, 'Home')
    const workId = archive.folders[1]!.id
    const homeId = archive.folders[2]!.id
    archive = addArchivedPlan(archive, archived, workId)
    archive = removeArchiveFolder(archive, workId, homeId)
    expect(archive.folders.map((f) => f.id)).toEqual([
      UNFILED_FOLDER_ID,
      homeId,
    ])
    expect(archive.folders[0]!.plans).toHaveLength(0)
    expect(archive.folders[1]!.plans[0]!.id).toBe(archived.id)
  })

  it('cannot delete or rename Unfiled', () => {
    const archive = renameArchiveFolder(
      defaultPlanArchive(),
      UNFILED_FOLDER_ID,
      'Nope',
    )
    expect(archive.folders[0]!.name).toBe(UNFILED_FOLDER_NAME)
    expect(removeArchiveFolder(archive, UNFILED_FOLDER_ID).folders).toHaveLength(
      1,
    )
  })

  it('duplicates a plan in the same folder', () => {
    const archived = archivedPlanFromGroup(group)
    let archive = addArchivedPlan(defaultPlanArchive(), archived)
    archive = duplicateArchivedPlan(archive, archived.id)
    expect(archive.folders[0]!.plans).toHaveLength(2)
    expect(archive.folders[0]!.plans[1]!.id).not.toBe(archived.id)
    expect(archive.folders[0]!.plans[1]!.name).toBe('Morning')
  })

  it('renames and recolors an archived plan', () => {
    const archived = archivedPlanFromGroup(group)
    let archive = addArchivedPlan(defaultPlanArchive(), archived)
    archive = renameArchivedPlan(archive, archived.id, 'Evening')
    expect(archive.folders[0]!.plans[0]!.name).toBe('Evening')
    archive = setArchivedPlanColor(archive, archived.id, '#aabbcc')
    expect(archive.folders[0]!.plans[0]!.color).toBe('#aabbcc')
    archive = setArchivedPlanColor(archive, archived.id, undefined)
    expect(archive.folders[0]!.plans[0]!).not.toHaveProperty('color')
  })

  it('remove returns the snapshot for undo', () => {
    const archived = archivedPlanFromGroup(group)
    const archive = addArchivedPlan(defaultPlanArchive(), archived)
    const { archive: next, removed } = removeArchivedPlan(archive, archived.id)
    expect(removed?.id).toBe(archived.id)
    expect(next.folders[0]!.plans).toHaveLength(0)
  })

  it('matches search on name or block title', () => {
    const archived = archivedPlanFromGroup(group)
    expect(archivedPlanMatchesQuery(archived, 'morn')).toBe(true)
    expect(archivedPlanMatchesQuery(archived, 'wake')).toBe(true)
    expect(archivedPlanMatchesQuery(archived, 'xyz')).toBe(false)
  })

  it('normalizes missing payloads to Unfiled', () => {
    expect(normalizePlanArchive(null).folders[0]!.id).toBe(UNFILED_FOLDER_ID)
    expect(normalizePlanArchive({ folders: 'nope' }).folders[0]!.id).toBe(
      UNFILED_FOLDER_ID,
    )
  })

  it('detects plans or folders being lost', () => {
    const archived = archivedPlanFromGroup(group)
    const current = addArchiveFolder(
      addArchivedPlan(defaultPlanArchive(), archived),
      'Work',
    )
    const moved = moveArchivedPlanToFolder(
      current,
      archived.id,
      current.folders[1]!.id,
    )
    expect(planArchiveShrinks(moved, current)).toBe(false)
    expect(
      planArchiveShrinks(addArchivedPlan(defaultPlanArchive(), archived), current),
    ).toBe(true)
    expect(planArchiveShrinks(defaultPlanArchive(), current)).toBe(true)
  })

  it('reorders folders including Unfiled', () => {
    let archive = addArchiveFolder(defaultPlanArchive(), 'Work')
    archive = addArchiveFolder(archive, 'Home')
    const workId = archive.folders[1]!.id
    const homeId = archive.folders[2]!.id
    archive = moveArchiveFolder(archive, UNFILED_FOLDER_ID, 1)
    expect(archive.folders.map((f) => f.id)).toEqual([
      workId,
      UNFILED_FOLDER_ID,
      homeId,
    ])
    archive = moveArchiveFolder(archive, workId, 1)
    expect(archive.folders.map((f) => f.id)).toEqual([
      UNFILED_FOLDER_ID,
      workId,
      homeId,
    ])
    archive = moveArchiveFolder(archive, UNFILED_FOLDER_ID, -1)
    expect(archive.folders.map((f) => f.id)).toEqual([
      UNFILED_FOLDER_ID,
      workId,
      homeId,
    ])
    archive = moveArchiveFolder(archive, homeId, 1)
    expect(archive.folders.map((f) => f.id)).toEqual([
      UNFILED_FOLDER_ID,
      workId,
      homeId,
    ])
  })

  it('keeps Unfiled in place when normalizing', () => {
    const archive = normalizePlanArchive({
      folders: [
        { id: 'work', name: 'Work', plans: [] },
        { id: UNFILED_FOLDER_ID, name: 'Unfiled', plans: [] },
      ],
      updatedAt: '2026-08-14T00:00:00.000Z',
    })
    expect(archive.folders.map((f) => f.id)).toEqual([
      'work',
      UNFILED_FOLDER_ID,
    ])
  })

  it('formats archived dates compactly', () => {
    const now = new Date(2026, 7, 14)
    expect(formatArchivedDate(new Date(2026, 7, 14), now)).toBe('Aug 14')
    expect(formatArchivedDate(new Date(2025, 11, 3), now)).toBe('Dec 3, 2025')
    expect(formatArchivedDate('not-a-date', now)).toBe('')
  })
})
