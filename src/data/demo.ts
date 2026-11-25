import { db } from './database'
import { nowIso } from './settings'
import type { AttendanceRecord, ClassSession, Semester, Subject } from './models'

export function isDemoMode(): boolean {
  return typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('demo') === '1'
}

export async function seedDemoData(): Promise<void> {
  if (!isDemoMode()) throw new Error('Sample data can only be loaded in Demo Mode')
  const now = nowIso()
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))

    const semester: Semester = {
      id: 'demo-semester',
      name: 'Demo Semester',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    }
    await db.semesters.add(semester)

    const subjects: Subject[] = [
      ['demo-ds', 'Data Structures', 'CS301', 4, 75, '#4f46e5', 'theory'],
      ['demo-ma', 'Engineering Mathematics', 'MA301', 3, 75, '#0891b2', 'theory'],
      ['demo-db', 'Database Laboratory', 'DBL301', 2, 85, '#d97706', 'laboratory'],
    ].map(([id, name, code, credits, attendanceTarget, color, kind]) => ({
      id: String(id),
      semesterId: semester.id,
      name: String(name),
      code: String(code),
      facultyName: 'Demo Faculty',
      credits: Number(credits),
      kind: kind as Subject['kind'],
      attendanceTarget: Number(attendanceTarget),
      color: String(color),
      archived: false,
      createdAt: now,
      updatedAt: now,
    }))
    await db.subjects.bulkAdd(subjects)

    for (let index = 0; index < subjects.length; index += 1) {
      const subject = subjects[index]!
      await db.timetableRules.add({
        id: `demo-rule-${subject.id}`,
        subjectId: subject.id,
        weekday: index + 1,
        startTime: '09:00',
        endTime: '10:00',
        facultyName: 'Demo Faculty',
        room: `Demo Room ${index + 1}`,
        kind: subject.kind === 'laboratory' ? 'laboratory' : 'lecture',
        recurring: true,
        startDate: '2026-07-01',
        active: true,
        createdAt: now,
        updatedAt: now,
      })

      for (let sessionIndex = 0; sessionIndex < 8; sessionIndex += 1) {
        const sessionId = `${subject.id}-session-${sessionIndex}`
        const status: ClassSession['status'] = 'conducted'
        await db.classSessions.add({
          id: sessionId,
          date: `2026-11-${String(sessionIndex + 1).padStart(2, '0')}`,
          timetableRuleId: `demo-rule-${subject.id}`,
          subjectId: subject.id,
          status,
          notes: '',
          createdAt: now,
          updatedAt: now,
        })
        await db.attendanceRecords.add({
          id: `${sessionId}-record`,
          sessionId,
          subjectId: subject.id,
          status: sessionIndex % 4 === 0 ? 'absent' : 'present',
          recordedAt: now,
          createdAt: now,
          updatedAt: now,
        } satisfies AttendanceRecord)
      }
    }
  })
}

export async function resetDemoData(): Promise<void> {
  if (!isDemoMode()) throw new Error('Demo reset is only available in Demo Mode')
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}

export async function enterDemoMode(): Promise<void> {
  const url = new URL(window.location.href)
  url.searchParams.set('demo', '1')
  sessionStorage.setItem('studentmate-demo-needs-seed', '1')
  window.location.assign(url.toString())
}
