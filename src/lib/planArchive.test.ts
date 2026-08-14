import { describe, expect, it } from 'vitest'
import {
  addArchiveFolder,
  addArchivedPlan,
  archivedPlanFromGroup,
  archivedPlanMatchesQuery,
  blockGroupFromArchivedPlan,
  defaultPlanArchive,
  duplicateArchivedPlan,
  moveArchivedPlanToFolder,
  moveArchiveFolder,
  normalizePlanArchive,
  removeArchiveFolder,
  removeArchivedPlan,
  renameArchiveFolder,
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

  it('adds to Unfiled and can move into a named folder', () => {
    const archived = archivedPlanFromGroup(group)
    let archive = addArchivedPlan(defaultPlanArchive(), archived)
    expect(archive.folders[0]!.plans).toHaveLength(1)
    archive = addArchiveFolder(archive, 'Work')
    const workId = archive.folders[1]!.id
    archive = moveArchivedPlanToFolder(archive, archived.id, workId)
    expect(archive.folders[0]!.plans).toHaveLength(0)
    expect(archive.folders[1]!.plans[0]!.id).toBe(archived.id)
  })

  it('deleting a folder sends plans back to Unfiled', () => {
    const archived = archivedPlanFromGroup(group)
    let archive = addArchiveFolder(defaultPlanArchive(), 'Work')
    const workId = archive.folders[1]!.id
    archive = addArchivedPlan(archive, archived, workId)
    archive = removeArchiveFolder(archive, workId)
    expect(archive.folders).toHaveLength(1)
    expect(archive.folders[0]!.id).toBe(UNFILED_FOLDER_ID)
    expect(archive.folders[0]!.plans[0]!.id).toBe(archived.id)
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

  it('does not move Unfiled when reordering folders', () => {
    let archive = addArchiveFolder(defaultPlanArchive(), 'Work')
    archive = addArchiveFolder(archive, 'Home')
    const workId = archive.folders[1]!.id
    archive = moveArchiveFolder(archive, workId, -1)
    expect(archive.folders[0]!.id).toBe(UNFILED_FOLDER_ID)
    archive = moveArchiveFolder(archive, UNFILED_FOLDER_ID, 1)
    expect(archive.folders[0]!.id).toBe(UNFILED_FOLDER_ID)
  })
})
