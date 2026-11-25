import { db } from './database'
import { createId, nowIso } from './settings'
import type { AttendanceRecord, AttendanceStatus, ClassSession, SessionStatus } from './models'
import { requireDate } from './validation'

export async function saveClassSession(
  input: Omit<ClassSession, 'id' | 'createdAt' | 'updatedAt'>,
  id?: string,
): Promise<ClassSession> {
  requireDate(input.date, 'Session date')
  if (!input.subjectId) throw new Error('Session subject is required')
  if (!(await db.subjects.get(input.subjectId))) throw new Error('The selected subject does not exist')
  const now = nowIso()
  const record: ClassSession = { ...input, id: id ?? createId(), createdAt: now, updatedAt: now }
  if (id) {
    const previous = await db.classSessions.get(id)
    if (!previous) throw new Error('Class session no longer exists')
    await db.classSessions.put({ ...previous, ...input, updatedAt: now })
  } else {
    const duplicate = await db.classSessions
      .where('date')
      .equals(input.date)
      .filter((session) =>
        session.timetableRuleId === input.timetableRuleId &&
        session.subjectId === input.subjectId,
      )
      .first()
    if (duplicate) throw new Error('This class session is already recorded for that date')
    await db.classSessions.add(record)
  }
  return (await db.classSessions.get(record.id)) ?? record
}

export async function setSessionStatus(id: string, status: SessionStatus): Promise<void> {
  await db.transaction('rw', db.classSessions, async () => {
    await db.classSessions.update(id, { status, updatedAt: nowIso() })
  })
}

export async function markAttendance(
  sessionId: string,
  subjectId: string,
  status: AttendanceStatus,
): Promise<AttendanceRecord> {
  const now = nowIso()
  const existing = await db.attendanceRecords.where('sessionId').equals(sessionId).first()
  if (existing) {
    await db.attendanceRecords.update(existing.id, { status, subjectId, recordedAt: now })
    await db.attendanceChangeLog.add({
      id: createId(),
      entityType: 'attendance',
      entityId: existing.id,
      action: 'update',
      previousValue: existing.status,
      newValue: status,
      reason: '',
      createdAt: now,
      updatedAt: now,
    })
    return (await db.attendanceRecords.get(existing.id)) as AttendanceRecord
  }

  const record: AttendanceRecord = {
    id: createId(),
    sessionId,
    subjectId,
    status,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  await db.attendanceRecords.add(record)
  await db.attendanceChangeLog.add({
    id: createId(),
    entityType: 'attendance',
    entityId: record.id,
    action: 'create',
    previousValue: '',
    newValue: status,
    reason: '',
    createdAt: now,
    updatedAt: now,
  })
  return record
}

export async function listSessions(date?: string) {
  if (date) return db.classSessions.where('date').equals(date).toArray()
  return db.classSessions.orderBy('date').reverse().toArray()
}

export async function listAttendanceRecords(subjectId?: string) {
  if (subjectId) return db.attendanceRecords.where('subjectId').equals(subjectId).toArray()
  return db.attendanceRecords.toArray()
}
