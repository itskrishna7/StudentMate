import { afterEach, describe, expect, it } from 'vitest'
import { db } from './database'
import {
  createFullBackup,
  previewRestore,
  restoreBackup,
  validateBackupText,
} from './backup'

afterEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

describe('backup and restore', () => {
  it('creates and validates a full JSON backup', async () => {
    await db.subjects.add({
      id: 'subject-1',
      semesterId: 'semester-1',
      name: 'Mathematics',
      code: 'MTH101',
      facultyName: '',
      credits: 4,
      kind: 'theory',
      attendanceTarget: 75,
      color: '#4f46e5',
      archived: false,
      createdAt: '',
      updatedAt: '',
    })
    const backup = await createFullBackup()
    expect(validateBackupText(JSON.stringify(backup)).data.subjects).toHaveLength(1)
  })

  it('detects duplicate ids and restores without overwriting', async () => {
    await db.subjects.add({
      id: 'subject-1',
      semesterId: 'semester-1',
      name: 'Original name',
      code: 'MTH101',
      facultyName: '',
      credits: 4,
      kind: 'theory',
      attendanceTarget: 75,
      color: '#4f46e5',
      archived: false,
      createdAt: '',
      updatedAt: '',
    })
    const backup = await createFullBackup()
    const originalSubject = backup.data.subjects![0] as Record<string, unknown>
    backup.data.subjects = [{
      ...originalSubject,
      name: 'Imported name',
    }]

    const preview = await previewRestore(backup)
    expect(preview.duplicateRows).toBe(1)
    await restoreBackup(backup)
    expect((await db.subjects.get('subject-1'))?.name).toBe('Original name')
  })

  it('rejects malformed and unsupported backups', () => {
    expect(() => validateBackupText('{bad')).toThrow('malformed JSON')
    expect(() => validateBackupText(JSON.stringify({ format: 'other' }))).toThrow('Unrecognized')
  })

  it('rejects rows with missing required fields', async () => {
    const backup = await createFullBackup()
    backup.data.subjects = [{ id: 'bad-subject', name: 'Missing required fields' }]
    await expect(previewRestore(backup)).rejects.toThrow('missing "semesterId"')
  })

  it('rejects malicious subject CSS colors in restored backups', async () => {
    const backup = await createFullBackup()
    backup.data.subjects = [{
      id: 'bad-color',
      semesterId: 'semester-1',
      name: 'Synthetic',
      code: 'TEST',
      facultyName: '',
      credits: 3,
      kind: 'theory',
      attendanceTarget: 75,
      color: 'url(https://example.invalid/tracker)',
      archived: false,
      createdAt: '',
      updatedAt: '',
    }]
    await expect(previewRestore(backup)).rejects.toThrow('six-digit hex color')
  })
})
