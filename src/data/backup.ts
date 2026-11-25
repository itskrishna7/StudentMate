import { db } from './database'

export const BACKUP_FORMAT = 'studentmate'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_SIZE = 50 * 1024 * 1024

export interface StudentMateBackup {
  format: typeof BACKUP_FORMAT
  backupVersion: typeof BACKUP_VERSION
  databaseVersion: number
  createdAt: string
  data: Record<string, unknown[]>
}

const tableNames = [
  'semesters',
  'subjects',
  'timetableRules',
  'calendarEvents',
  'classSessions',
  'attendanceRecords',
  'attendanceChangeLog',
  'scheduleChangeLog',
  'assessments',
  'marks',
  'gradingScales',
  'appSettings',
  'importJobs',
] as const

export async function createFullBackup(): Promise<StudentMateBackup> {
  const data: Record<string, unknown[]> = {}
  await db.transaction('r', db.tables, async () => {
    for (const tableName of tableNames) {
      data[tableName] = await (db.table(tableName).toArray() as Promise<unknown[]>)
    }
  })
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    databaseVersion: db.verno,
    createdAt: new Date().toISOString(),
    data,
  }
}

export function downloadJsonBackup(backup: StudentMateBackup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `studentmate-backup-${backup.createdAt.slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function validateBackupText(text: string): StudentMateBackup {
  if (text.length > MAX_BACKUP_SIZE) throw new Error('Backup is larger than the 50 MB limit')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Backup contains malformed JSON')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Backup must be a JSON object')
  const backup = parsed as Partial<StudentMateBackup>
  if (backup.format !== BACKUP_FORMAT) throw new Error('Unrecognized backup format')
  if (backup.backupVersion !== BACKUP_VERSION) throw new Error('Unsupported backup version')
  if (!Number.isInteger(backup.databaseVersion) || backup.databaseVersion! < 1) {
    throw new Error('Backup database version is invalid')
  }
  if (!backup.createdAt || Number.isNaN(Date.parse(backup.createdAt))) {
    throw new Error('Backup creation date is invalid')
  }
  if (!backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    throw new Error('Backup data section is invalid')
  }

  for (const tableName of tableNames) {
    const rows = (backup.data as Record<string, unknown>)[tableName]
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new Error(`Backup table "${tableName}" must contain an array`)
    }
  }
  return backup as StudentMateBackup
}

export interface RestorePreview {
  totalRows: number
  duplicateRows: number
  additions: number
  byTable: Record<string, { additions: number; duplicates: number }>
}

const requiredFields: Record<(typeof tableNames)[number], readonly string[]> = {
  semesters: ['name', 'startDate', 'endDate'],
  subjects: ['semesterId', 'name', 'credits', 'attendanceTarget'],
  timetableRules: ['subjectId', 'weekday', 'startTime', 'endTime'],
  calendarEvents: ['title', 'type', 'startDate', 'endDate'],
  classSessions: ['date', 'timetableRuleId', 'subjectId', 'status'],
  attendanceRecords: ['sessionId', 'subjectId', 'status'],
  attendanceChangeLog: ['entityType', 'entityId', 'action'],
  scheduleChangeLog: ['entityType', 'entityId', 'action'],
  assessments: ['subjectId', 'name', 'type', 'maxMarks', 'weight'],
  marks: ['assessmentId', 'subjectId', 'marksObtained'],
  gradingScales: ['name', 'boundaries', 'passingPercentage'],
  appSettings: ['key', 'value'],
  importJobs: ['kind', 'fileName', 'status', 'sourceType', 'extractedData'],
}

function requireString(row: Record<string, unknown>, field: string, tableName: string): string {
  const value = row[field]
  if (typeof value !== 'string') throw new Error(`Invalid row in "${tableName}": "${field}" must be a string`)
  if (Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32
  })) throw new Error(`Invalid row in "${tableName}": "${field}" contains unsafe control characters`)
  return value
}

function validateBackupRow(tableName: (typeof tableNames)[number], row: Record<string, unknown>): void {
  requireString(row, 'id', tableName)

  if (tableName === 'subjects') {
    requireString(row, 'semesterId', tableName)
    requireString(row, 'name', tableName)
    if (typeof row.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(row.color)) {
      throw new Error('Invalid row in "subjects": "color" must be a six-digit hex color')
    }
    if (typeof row.credits !== 'number' || !Number.isFinite(row.credits) || row.credits < 0 || row.credits > 30) {
      throw new Error('Invalid row in "subjects": "credits" is out of range')
    }
    if (typeof row.attendanceTarget !== 'number' || !Number.isFinite(row.attendanceTarget) || row.attendanceTarget < 1 || row.attendanceTarget > 100) {
      throw new Error('Invalid row in "subjects": "attendanceTarget" is out of range')
    }
  }

  if (tableName === 'timetableRules') {
    requireString(row, 'subjectId', tableName)
    requireString(row, 'startTime', tableName)
    requireString(row, 'endTime', tableName)
    if (!Number.isInteger(row.weekday) || Number(row.weekday) < 0 || Number(row.weekday) > 6) {
      throw new Error('Invalid row in "timetableRules": "weekday" is out of range')
    }
  }

  if (tableName === 'calendarEvents') {
    requireString(row, 'title', tableName)
    requireString(row, 'type', tableName)
    requireString(row, 'startDate', tableName)
    requireString(row, 'endDate', tableName)
  }

  if (tableName === 'classSessions') {
    requireString(row, 'date', tableName)
    requireString(row, 'timetableRuleId', tableName)
    requireString(row, 'subjectId', tableName)
    requireString(row, 'status', tableName)
  }

  if (tableName === 'attendanceRecords') {
    requireString(row, 'sessionId', tableName)
    requireString(row, 'subjectId', tableName)
    requireString(row, 'status', tableName)
  }

  if (tableName === 'assessments') {
    requireString(row, 'subjectId', tableName)
    requireString(row, 'name', tableName)
    if (typeof row.maxMarks !== 'number' || !Number.isFinite(row.maxMarks) || row.maxMarks <= 0 || row.maxMarks > 100000) {
      throw new Error('Invalid row in "assessments": "maxMarks" is out of range')
    }
    if (typeof row.weight !== 'number' || !Number.isFinite(row.weight) || row.weight < 0 || row.weight > 100) {
      throw new Error('Invalid row in "assessments": "weight" is out of range')
    }
  }

  if (tableName === 'marks') {
    requireString(row, 'assessmentId', tableName)
    requireString(row, 'subjectId', tableName)
    if (typeof row.marksObtained !== 'number' || !Number.isFinite(row.marksObtained) || row.marksObtained < 0) {
      throw new Error('Invalid row in "marks": "marksObtained" is invalid')
    }
  }

  if (tableName === 'gradingScales') {
    requireString(row, 'name', tableName)
    if (!Array.isArray(row.boundaries) || row.boundaries.length === 0) {
      throw new Error('Invalid row in "gradingScales": "boundaries" must be a non-empty array')
    }
  }

  if (tableName === 'appSettings') {
    requireString(row, 'key', tableName)
    requireString(row, 'value', tableName)
  }

  if (tableName === 'importJobs') {
    requireString(row, 'fileName', tableName)
    requireString(row, 'extractedData', tableName)
  }
}

export async function previewRestore(backup: StudentMateBackup): Promise<RestorePreview> {
  const byTable: RestorePreview['byTable'] = {}
  let totalRows = 0
  let duplicateRows = 0
  let additions = 0

  await db.transaction('r', db.tables, async () => {
    for (const tableName of tableNames) {
      const rows = backup.data[tableName] ?? []
      let tableDuplicates = 0
      for (const row of rows) {
        if (!row || typeof row !== 'object') throw new Error(`Invalid row in "${tableName}"`)
        const record = row as Record<string, unknown>
        const id = record.id
        if (typeof id !== 'string' || id.length === 0) throw new Error(`Invalid id in "${tableName}"`)
        for (const field of requiredFields[tableName]) {
          if (!(field in record)) throw new Error(`Invalid row in "${tableName}": missing "${field}"`)
        }
        validateBackupRow(tableName, record)
        if (await db.table(tableName).get(id)) tableDuplicates += 1
      }
      const tableAdditions = rows.length - tableDuplicates
      byTable[tableName] = { additions: tableAdditions, duplicates: tableDuplicates }
      totalRows += rows.length
      duplicateRows += tableDuplicates
      additions += tableAdditions
    }
  })
  return { totalRows, duplicateRows, additions, byTable }
}

export async function restoreBackup(backup: StudentMateBackup): Promise<RestorePreview> {
  const preview = await previewRestore(backup)
  await db.transaction('rw', db.tables, async () => {
    for (const tableName of tableNames) {
      for (const row of backup.data[tableName] ?? []) {
        const id = (row as { id: string }).id
        if (!(await db.table(tableName).get(id))) await db.table(tableName).add(row)
      }
    }
  })
  return preview
}
