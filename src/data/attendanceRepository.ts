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

export async function markDayAsHoliday(date: string): Promise<number> {
  requireDate(date, 'Holiday date')
  const weekday = new Date(`${date}T00:00:00`).getDay()

  return db.transaction('rw', db.classSessions, db.timetableRules, db.subjects, async () => {
    const [daySessions, rules] = await Promise.all([
      db.classSessions.where('date').equals(date).toArray(),
      db.timetableRules.toArray(),
    ])
    const scheduledRules = rules.filter((rule) =>
      rule.active &&
      rule.weekday === weekday &&
      rule.startDate <= date &&
      (!rule.endDate || rule.endDate >= date),
    )
    const sessionRuleIds = new Set(daySessions.map((session) => session.timetableRuleId))
    const now = nowIso()
    let createdCount = 0

    for (const rule of scheduledRules) {
      if (sessionRuleIds.has(rule.id)) continue
      if (!(await db.subjects.get(rule.subjectId))) {
        throw new Error('A scheduled class references a subject that no longer exists')
      }
      await db.classSessions.add({
        id: createId(),
        date,
        timetableRuleId: rule.id,
        subjectId: rule.subjectId,
        status: 'holiday',
        notes: '',
        createdAt: now,
        updatedAt: now,
      })
      createdCount += 1
    }

    await Promise.all(daySessions
      .filter((session) => session.status !== 'holiday')
      .map((session) => db.classSessions.update(session.id, { status: 'holiday', updatedAt: now })))

    return daySessions.length + createdCount
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
