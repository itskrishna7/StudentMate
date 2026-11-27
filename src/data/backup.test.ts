import { afterEach, describe, expect, it } from 'vitest'
import { db } from './database'
import { getSubjectMarkingScheme, saveSubjectMarkingScheme } from './markingSchemes'
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

  it('backs up and restores semester results without replacing existing rows', async () => {
    await db.studentSemesterResults.add({
      id: 'semester-result-1',
      semesterNumber: 1,
      sgpa: 8.25,
      totalCredits: 20,
      status: 'completed',
      academicYear: '2025-2026',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const backup = await createFullBackup()
    expect(backup.data.studentSemesterResults).toHaveLength(1)

    await db.studentSemesterResults.clear()
    await restoreBackup(validateBackupText(JSON.stringify(backup)))
    expect((await db.studentSemesterResults.get('semester-result-1'))?.sgpa).toBe(8.25)
  })

  it('backs up and restores subject marking schemes using existing settings storage', async () => {
    const scheme = {
      calculationMethod: 'average' as const,
      passingPercentage: 50,
      decimalPrecision: 1,
      boundaries: [{ minPercentage: 0, gradePoint: 0, label: 'Fail', pass: false }],
    }
    await saveSubjectMarkingScheme('subject-1', scheme)

    const backup = validateBackupText(JSON.stringify(await createFullBackup()))
    expect(backup.data.appSettings).toHaveLength(1)
    await db.appSettings.clear()
    await restoreBackup(backup)

    expect(await getSubjectMarkingScheme('subject-1')).toEqual(scheme)
  })

  it('does not overwrite an existing subject scheme when an imported backup has a different setting id', async () => {
    const savedScheme = {
      calculationMethod: 'average' as const,
      passingPercentage: 50,
      decimalPrecision: 1,
      boundaries: [{ minPercentage: 0, gradePoint: 0, label: 'Fail', pass: false }],
    }
    const existingScheme = {
      ...savedScheme,
      calculationMethod: 'total' as const,
      passingPercentage: 45,
    }
    await saveSubjectMarkingScheme('subject-1', savedScheme)
    const backup = await createFullBackup()
    const importedSetting = backup.data.appSettings![0] as Record<string, unknown>
    importedSetting.id = 'different-device-setting-id'
    await saveSubjectMarkingScheme('subject-1', existingScheme)

    expect(await previewRestore(backup)).toMatchObject({
      additions: 0,
      duplicateRows: 1,
      byTable: { appSettings: { additions: 0, duplicates: 1 } },
    })
    await restoreBackup(backup)
    expect(await getSubjectMarkingScheme('subject-1')).toEqual(existingScheme)
  })

  it('previews semester-number conflicts as duplicates without overwriting existing results', async () => {
    await db.studentSemesterResults.add({
      id: 'existing-result',
      semesterNumber: 1,
      sgpa: 7,
      totalCredits: 18,
      status: 'completed',
      createdAt: '',
      updatedAt: '',
    })
    const backup = await createFullBackup()
    backup.data.studentSemesterResults = [{
      id: 'conflicting-result',
      semesterNumber: 1,
      sgpa: 9,
      totalCredits: 20,
      status: 'completed',
      createdAt: '',
      updatedAt: '',
    }]

    expect(await previewRestore(backup)).toMatchObject({
      additions: 0,
      duplicateRows: 1,
      byTable: { studentSemesterResults: { additions: 0, duplicates: 1 } },
    })
    await restoreBackup(backup)
    expect(await db.studentSemesterResults.count()).toBe(1)
    expect((await db.studentSemesterResults.get('existing-result'))?.sgpa).toBe(7)
  })

  it('handles repeated semester numbers inside an imported backup', async () => {
    const backup = await createFullBackup()
    backup.data.studentSemesterResults = [
      { id: 'semester-one-a', semesterNumber: 1, sgpa: 8, totalCredits: 20, status: 'completed', createdAt: '', updatedAt: '' },
      { id: 'semester-one-b', semesterNumber: 1, sgpa: 9, totalCredits: 20, status: 'completed', createdAt: '', updatedAt: '' },
    ]

    expect(await previewRestore(backup)).toMatchObject({
      additions: 1,
      duplicateRows: 1,
      byTable: { studentSemesterResults: { additions: 1, duplicates: 1 } },
    })
    await restoreBackup(backup)
    expect(await db.studentSemesterResults.count()).toBe(1)
  })

  it('accepts and restores older backups that do not contain the new results store', async () => {
    const backup = await createFullBackup()
    delete backup.data.studentSemesterResults

    expect(() => validateBackupText(JSON.stringify(backup))).not.toThrow()
    await expect(restoreBackup(backup)).resolves.toMatchObject({ additions: 0 })
  })

  it('rejects invalid semester result records in backup files', async () => {
    const backup = await createFullBackup()
    backup.data.studentSemesterResults = [{
      id: 'invalid-semester-result',
      semesterNumber: 9,
      status: 'completed',
      sgpa: 9,
      totalCredits: 20,
    }]
    await expect(previewRestore(backup)).rejects.toThrow('semesterNumber')
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
